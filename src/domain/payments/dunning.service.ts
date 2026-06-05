import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { UserMembership } from '../memberships/userMembership.model';
import { DunningState, IDunningRetryScheduleItem } from './dunningState.model';
import { createMembershipNotice } from './membershipNotification.service';
import { paymentAuditActions } from './payment.audit';

const DAY_MS = 24 * 60 * 60_000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function retrySchedule(failedAt: Date): IDunningRetryScheduleItem[] {
  return [
    { day: 0, scheduledAt: failedAt, status: 'pending' },
    { day: 3, scheduledAt: addDays(failedAt, 3), status: 'pending' },
    { day: 7, scheduledAt: addDays(failedAt, 7), status: 'pending' },
  ];
}

function nextPendingSchedule(schedule: IDunningRetryScheduleItem[], now: Date) {
  return schedule
    .filter((item) => item.status === 'pending' && item.scheduledAt > now)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
}

function markDueRetries(schedule: IDunningRetryScheduleItem[], now: Date, days: number[]) {
  let marked = 0;
  for (const item of schedule) {
    if (days.includes(item.day) && item.status === 'pending' && item.scheduledAt <= now) {
      item.status = 'attempted';
      item.attemptedAt = now;
      marked += 1;
    }
  }
  return marked;
}

export async function startDunningForPaymentFailure(params: {
  userId: Types.ObjectId;
  userMembershipId: Types.ObjectId;
  paymentRecordId?: Types.ObjectId;
  failedAt?: Date;
  failureReason?: string;
}) {
  const failedAt = params.failedAt ?? new Date();
  const graceEndsAt = addDays(failedAt, 3);

  const membership = await UserMembership.findById(params.userMembershipId);
  if (!membership) throw new Error('membership_not_found');

  membership.status = 'grace_period';
  membership.graceEndsAt = graceEndsAt;
  membership.suspendedAt = undefined;
  await membership.save();

  const state = await DunningState.findOneAndUpdate(
    {
      userMembershipId: params.userMembershipId,
      status: 'active',
    },
    {
      $set: {
        userId: params.userId,
        userMembershipId: params.userMembershipId,
        paymentRecordId: params.paymentRecordId,
        status: 'active',
        failedAt,
        graceEndsAt,
        nextActionAt: graceEndsAt,
        retrySchedule: retrySchedule(failedAt),
        lastFailureReason: params.failureReason,
        recoveredAt: undefined,
        suspendedAt: undefined,
        cancelledAt: undefined,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );

  await Audit.create({ actor: String(params.userId), action: paymentAuditActions.paymentFailed });
  await createMembershipNotice(params.userId, 'payment_failed');
  await createMembershipNotice(params.userId, 'grace_period_started');

  return state;
}

export async function recoverDunningForMembership(params: {
  userId: Types.ObjectId;
  userMembershipId: Types.ObjectId;
  recoveredAt?: Date;
}) {
  const recoveredAt = params.recoveredAt ?? new Date();
  const state = await DunningState.findOne({
    userMembershipId: params.userMembershipId,
    status: 'active',
  });
  if (!state) return null;

  state.status = 'recovered';
  state.recoveredAt = recoveredAt;
  state.nextActionAt = undefined;
  await state.save();

  await UserMembership.findByIdAndUpdate(
    params.userMembershipId,
    {
      $set: { status: 'active' },
      $unset: { graceEndsAt: '', suspendedAt: '' },
    },
    { runValidators: true }
  );

  await Audit.create({ actor: String(params.userId), action: paymentAuditActions.dunningRecovered });
  await createMembershipNotice(params.userId, 'recovered');

  return state;
}

export type ProcessDunningDueResult = {
  processed: number;
  movedToDunning: number;
  suspended: number;
  skipped: number;
  errors: string[];
};

export async function processDunningDue(now: Date = new Date()): Promise<ProcessDunningDueResult> {
  const result: ProcessDunningDueResult = {
    processed: 0,
    movedToDunning: 0,
    suspended: 0,
    skipped: 0,
    errors: [],
  };

  const states = await DunningState.find({
    status: 'active',
    nextActionAt: { $lte: now },
  }).sort({ nextActionAt: 1 });

  for (const state of states) {
    try {
      const membership = await UserMembership.findById(state.userMembershipId);
      if (!membership) {
        result.skipped += 1;
        continue;
      }

      result.processed += 1;

      if (membership.status === 'grace_period' && state.graceEndsAt && state.graceEndsAt <= now) {
        markDueRetries(state.retrySchedule, now, [0, 3]);
        membership.status = 'in_dunning';
        await membership.save();
        result.movedToDunning += 1;
        await Audit.create({ actor: String(state.userId), action: paymentAuditActions.dunningStarted });
        await Audit.create({ actor: String(state.userId), action: paymentAuditActions.dunningRetryDue });
        await createMembershipNotice(state.userId, 'dunning_started');
        await createMembershipNotice(state.userId, 'dunning_retry');
      }

      const day7 = state.retrySchedule.find((item) => item.day === 7);
      if (day7 && day7.status === 'pending' && day7.scheduledAt <= now) {
        markDueRetries(state.retrySchedule, now, [7]);
        membership.status = 'suspended';
        membership.suspendedAt = now;
        await membership.save();

        state.status = 'suspended';
        state.suspendedAt = now;
        state.nextActionAt = undefined;
        await state.save();

        result.suspended += 1;
        await Audit.create({ actor: String(state.userId), action: paymentAuditActions.dunningSuspended });
        await createMembershipNotice(state.userId, 'suspended');
        continue;
      }

      const next = nextPendingSchedule(state.retrySchedule, now);
      state.nextActionAt = next?.scheduledAt;
      await state.save();
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}
