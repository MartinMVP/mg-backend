import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan } from './membershipPlan.model';
import { ensureDefaultMembershipPlans } from './membership.seed';
import { ensureFreeMembershipForUser, ensureMembershipUsageForPeriod, getUserMembership } from './membership.service';
import { MembershipUsage } from './membershipUsage.model';
import { MembershipChangeLog, MembershipChangeSource } from './membershipChangeLog.model';
import { createMembershipChangeNotice } from './membershipChangeNotification.service';
import { membershipAuditActions } from './membership.audit';
import {
  operationallyActiveMembershipStatuses,
  UserMembership,
} from './userMembership.model';

const FREE_PERIOD_MS = 365 * 24 * 60 * 60_000;

function toObjectId(value: string | Types.ObjectId) {
  return typeof value === 'string' ? new Types.ObjectId(value) : value;
}

async function audit(actor: string | Types.ObjectId, action: string) {
  await Audit.create({ actor: String(actor), action });
}

async function guaranteeActiveFreeMembership(userId: Types.ObjectId) {
  const existingActive = await UserMembership.findOne({
    userId,
    status: { $in: operationallyActiveMembershipStatuses },
  });
  if (existingActive) return existingActive;

  const freePlan = await ensureDefaultMembershipPlans();
  if (!freePlan) throw new Error('free_membership_plan_not_found');

  const now = new Date();
  const membership = await UserMembership.create({
    userId,
    planId: freePlan._id,
    status: 'active',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + FREE_PERIOD_MS),
    renewalMode: 'manual',
    source: 'manual',
    paymentProvider: 'none',
  });
  await ensureMembershipUsageForPeriod(membership);
  return membership;
}

function isPaidUpgrade(current: any, target: any) {
  return target.price > 0 && target.price > current.price;
}

async function findTargetPlan(targetPlanCode: string) {
  const code = String(targetPlanCode || '').toLowerCase().trim();
  if (!code) throw new Error('membership_plan_code_required');

  const plan = await MembershipPlan.findOne({ code, isActive: true });
  if (!plan) throw new Error('membership_plan_not_found');
  return plan;
}

async function getMembershipByIdForChange(membershipId: string | Types.ObjectId) {
  const id = toObjectId(membershipId);
  const membership = await UserMembership.findById(id);
  if (!membership) throw new Error('membership_not_found');
  const plan = await MembershipPlan.findById(membership.planId);
  if (!plan) throw new Error('membership_plan_not_found');
  return { membership, plan };
}

export async function requestPlanChange(params: {
  userId?: string | Types.ObjectId;
  membershipId?: string | Types.ObjectId;
  targetPlanCode: string;
  source: MembershipChangeSource;
}) {
  const current = params.membershipId
    ? await getMembershipByIdForChange(params.membershipId)
    : await getUserMembership(params.userId as string | Types.ObjectId);

  const membership = current.membership;
  const currentPlan = params.membershipId ? current.plan : current.plan;
  const targetPlan = await findTargetPlan(params.targetPlanCode);

  if (String(targetPlan._id) === String(currentPlan?._id)) {
    return { ok: true, membership, plan: currentPlan, unchanged: true };
  }

  const userId = membership.userId;

  if (isPaidUpgrade(currentPlan, targetPlan)) {
    membership.pendingPlanId = targetPlan._id;
    membership.pendingChangeType = 'upgrade';
    membership.pendingChangeEffectiveAt = undefined;
    await membership.save();

    await MembershipChangeLog.create({
      userId,
      userMembershipId: membership._id,
      fromPlanId: currentPlan?._id,
      toPlanId: targetPlan._id,
      changeType: 'upgrade_requested',
      source: params.source,
      metadata: { requiresCheckout: true },
    });
    await audit(userId, membershipAuditActions.upgradeRequested);
    await createMembershipChangeNotice(userId, 'upgrade_requested');

    return {
      ok: false,
      requiresCheckout: true,
      reason: 'paid_upgrade_requires_checkout',
      membership,
      targetPlan,
    };
  }

  membership.pendingPlanId = targetPlan._id;
  membership.pendingChangeType = 'downgrade';
  membership.pendingChangeEffectiveAt = membership.currentPeriodEnd;
  await membership.save();

  await MembershipChangeLog.create({
    userId,
    userMembershipId: membership._id,
    fromPlanId: currentPlan?._id,
    toPlanId: targetPlan._id,
    changeType: 'downgrade_requested',
    effectiveAt: membership.currentPeriodEnd,
    source: params.source,
  });
  await MembershipChangeLog.create({
    userId,
    userMembershipId: membership._id,
    fromPlanId: currentPlan?._id,
    toPlanId: targetPlan._id,
    changeType: 'downgrade_scheduled',
    effectiveAt: membership.currentPeriodEnd,
    source: params.source,
  });
  await audit(userId, membershipAuditActions.downgradeRequested);
  await audit(userId, membershipAuditActions.downgradeScheduled);
  await createMembershipChangeNotice(userId, 'downgrade_scheduled');

  return { ok: true, scheduled: true, membership, targetPlan, effectiveAt: membership.currentPeriodEnd };
}

export async function requestCancellation(params: {
  userId?: string | Types.ObjectId;
  membershipId?: string | Types.ObjectId;
  reason?: string;
  source: MembershipChangeSource;
}) {
  const current = params.membershipId
    ? await getMembershipByIdForChange(params.membershipId)
    : await getUserMembership(params.userId as string | Types.ObjectId);
  const membership = current.membership;
  const now = new Date();

  membership.cancelAtPeriodEnd = true;
  membership.cancelScheduledAt = now;
  membership.cancelReason = params.reason;
  membership.pendingChangeType = 'cancellation';
  membership.pendingPlanId = undefined;
  membership.pendingChangeEffectiveAt = membership.currentPeriodEnd;
  await membership.save();

  await MembershipChangeLog.create({
    userId: membership.userId,
    userMembershipId: membership._id,
    fromPlanId: membership.planId,
    changeType: 'cancellation_requested',
    effectiveAt: membership.currentPeriodEnd,
    source: params.source,
    reason: params.reason,
  });
  await MembershipChangeLog.create({
    userId: membership.userId,
    userMembershipId: membership._id,
    fromPlanId: membership.planId,
    changeType: 'cancellation_scheduled',
    effectiveAt: membership.currentPeriodEnd,
    source: params.source,
    reason: params.reason,
  });
  await audit(membership.userId, membershipAuditActions.cancellationRequested);
  await audit(membership.userId, membershipAuditActions.cancellationScheduled);
  await createMembershipChangeNotice(membership.userId, 'cancellation_scheduled');

  return { ok: true, scheduled: true, membership, effectiveAt: membership.currentPeriodEnd };
}

export async function reactivateMembership(params: {
  userId?: string | Types.ObjectId;
  membershipId?: string | Types.ObjectId;
  source: MembershipChangeSource;
}) {
  const current = params.membershipId
    ? await getMembershipByIdForChange(params.membershipId)
    : await getUserMembership(params.userId as string | Types.ObjectId);
  const membership = current.membership;
  if (!membership.cancelAtPeriodEnd) return { ok: false, reason: 'membership_not_pending_cancellation', membership };

  membership.cancelAtPeriodEnd = false;
  membership.cancelScheduledAt = undefined;
  membership.cancelReason = undefined;
  membership.pendingPlanId = undefined;
  membership.pendingChangeType = undefined;
  membership.pendingChangeEffectiveAt = undefined;
  await membership.save();

  await MembershipChangeLog.create({
    userId: membership.userId,
    userMembershipId: membership._id,
    fromPlanId: membership.planId,
    toPlanId: membership.planId,
    changeType: 'reactivation_requested',
    source: params.source,
  });
  await MembershipChangeLog.create({
    userId: membership.userId,
    userMembershipId: membership._id,
    fromPlanId: membership.planId,
    toPlanId: membership.planId,
    changeType: 'reactivation_completed',
    source: params.source,
  });
  await audit(membership.userId, membershipAuditActions.reactivationRequested);
  await audit(membership.userId, membershipAuditActions.reactivationCompleted);
  await createMembershipChangeNotice(membership.userId, 'reactivation');

  return { ok: true, membership };
}

export async function processMembershipPendingChanges(now: Date = new Date()) {
  const result = {
    processed: 0,
    downgraded: 0,
    cancelled: 0,
    skipped: 0,
    errors: [] as string[],
  };

  const memberships = await UserMembership.find({
    pendingChangeEffectiveAt: { $lte: now },
    pendingChangeType: { $in: ['downgrade', 'cancellation'] },
  }).sort({ pendingChangeEffectiveAt: 1 });

  for (const membership of memberships) {
    try {
      result.processed += 1;

      if (membership.pendingChangeType === 'downgrade') {
        if (!membership.pendingPlanId) {
          result.skipped += 1;
          continue;
        }

        const fromPlanId = membership.planId;
        membership.planId = membership.pendingPlanId;
        membership.changedFromPlanId = fromPlanId;
        membership.changedAt = now;
        membership.pendingPlanId = undefined;
        membership.pendingChangeType = undefined;
        membership.pendingChangeEffectiveAt = undefined;
        membership.cancelAtPeriodEnd = false;
        await membership.save();
        await ensureMembershipUsageForPeriod(membership);
        await MembershipUsage.updateMany(
          {
            membershipId: membership._id,
            periodStart: membership.currentPeriodStart,
            periodEnd: membership.currentPeriodEnd,
          },
          { $set: { planId: membership.planId } }
        );

        await MembershipChangeLog.create({
          userId: membership.userId,
          userMembershipId: membership._id,
          fromPlanId,
          toPlanId: membership.planId,
          changeType: 'downgrade_completed',
          effectiveAt: now,
          source: 'system',
        });
        await audit(membership.userId, membershipAuditActions.downgradeCompleted);
        await audit(membership.userId, membershipAuditActions.pendingChangeProcessed);
        await createMembershipChangeNotice(membership.userId, 'downgrade_completed');
        result.downgraded += 1;
        continue;
      }

      if (membership.pendingChangeType === 'cancellation') {
        membership.status = 'cancelled';
        membership.cancelledAt = now;
        membership.cancelAtPeriodEnd = false;
        membership.pendingPlanId = undefined;
        membership.pendingChangeType = undefined;
        membership.pendingChangeEffectiveAt = undefined;
        await membership.save();
        await guaranteeActiveFreeMembership(membership.userId);

        await MembershipChangeLog.create({
          userId: membership.userId,
          userMembershipId: membership._id,
          fromPlanId: membership.planId,
          changeType: 'cancellation_completed',
          effectiveAt: now,
          source: 'system',
        });
        await audit(membership.userId, membershipAuditActions.cancellationCompleted);
        await audit(membership.userId, membershipAuditActions.pendingChangeProcessed);
        await createMembershipChangeNotice(membership.userId, 'cancellation_completed');
        result.cancelled += 1;
      }
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return result;
}

export async function getChangeLogList(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};

  if (query.userId && Types.ObjectId.isValid(String(query.userId))) filter.userId = new Types.ObjectId(String(query.userId));
  if (query.userMembershipId && Types.ObjectId.isValid(String(query.userMembershipId))) {
    filter.userMembershipId = new Types.ObjectId(String(query.userMembershipId));
  }
  if (query.changeType) filter.changeType = String(query.changeType);

  const items = await MembershipChangeLog.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate({ path: 'fromPlanId' })
    .populate({ path: 'toPlanId' })
    .lean();

  return { items, page, limit };
}
