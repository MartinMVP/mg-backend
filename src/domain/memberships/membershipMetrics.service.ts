import { Audit } from '../audit/audit.model';
import { PaymentRecord } from '../payments/paymentRecord.model';
import { DunningState } from '../payments/dunningState.model';
import { membershipAuditActions } from './membership.audit';
import { MembershipChangeLog } from './membershipChangeLog.model';
import { MembershipPlan } from './membershipPlan.model';
import { UserMembership, membershipStatuses } from './userMembership.model';

const planCodes = ['free', 'pro', 'business'] as const;

function emptyPlanCounts() {
  return { free: 0, pro: 0, business: 0 };
}

function emptyStatusCounts() {
  return Object.fromEntries(membershipStatuses.map((status) => [status, 0])) as Record<string, number>;
}

async function countMembershipsByPlan() {
  const counts = emptyPlanCounts();
  const plans = await MembershipPlan.find({ code: { $in: [...planCodes] } }).select('code').lean();

  for (const plan of plans) {
    const code = plan.code as keyof typeof counts;
    counts[code] = await UserMembership.countDocuments({ planId: plan._id });
  }

  return counts;
}

async function countMembershipStatuses() {
  const counts = emptyStatusCounts();
  const rows = await UserMembership.aggregate<{ _id: string; count: number }>([
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

async function countPayments() {
  const rows = await PaymentRecord.aggregate<{ _id: string; count: number }>([
    { $match: { status: { $in: ['succeeded', 'failed'] } } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

  return {
    succeeded: rows.find((row) => row._id === 'succeeded')?.count ?? 0,
    failed: rows.find((row) => row._id === 'failed')?.count ?? 0,
  };
}

async function countConversions() {
  const conversions = {
    free_to_pro: 0,
    free_to_business: 0,
    pro_to_business: 0,
  };
  const logs = await MembershipChangeLog.find({ changeType: { $in: ['upgrade_requested', 'upgrade_completed'] } })
    .populate({ path: 'fromPlanId', select: 'code' })
    .populate({ path: 'toPlanId', select: 'code' })
    .lean();

  for (const log of logs) {
    const from = (log.fromPlanId as any)?.code;
    const to = (log.toPlanId as any)?.code;
    if (from === 'free' && to === 'pro') conversions.free_to_pro += 1;
    if (from === 'free' && to === 'business') conversions.free_to_business += 1;
    if (from === 'pro' && to === 'business') conversions.pro_to_business += 1;
  }

  return conversions;
}

async function createAlertOnce(action: string) {
  const exists = await Audit.exists({ actor: 'system', action });
  if (!exists) await Audit.create({ actor: 'system', action });
}

export async function generateMembershipOperationalAlerts() {
  const [payments, totalMemberships, dunningActive, cancellations] = await Promise.all([
    countPayments(),
    UserMembership.countDocuments(),
    DunningState.countDocuments({ status: 'active' }),
    MembershipChangeLog.countDocuments({ changeType: 'cancellation_completed' }),
  ]);

  const totalPayments = payments.succeeded + payments.failed;
  const actions: string[] = [];

  if (totalMemberships > 0 && dunningActive / totalMemberships >= 0.25) {
    actions.push(membershipAuditActions.highDunningRate);
  }
  if (totalMemberships > 0 && cancellations / totalMemberships >= 0.25) {
    actions.push(membershipAuditActions.highCancellationRate);
  }
  if (totalPayments > 0 && payments.failed / totalPayments >= 0.25) {
    actions.push(membershipAuditActions.highPaymentFailureRate);
  }

  for (const action of actions) await createAlertOnce(action);
  return { actions };
}

export async function getMembershipMetrics() {
  const [plans, memberships, payments, conversions, cancellations, suspensions, recoveries] = await Promise.all([
    countMembershipsByPlan(),
    countMembershipStatuses(),
    countPayments(),
    countConversions(),
    MembershipChangeLog.countDocuments({ changeType: 'cancellation_completed' }),
    UserMembership.countDocuments({ status: 'suspended' }),
    DunningState.countDocuments({ status: 'recovered' }),
  ]);

  return {
    plans,
    memberships,
    payments,
    conversions,
    cancellations: { total: cancellations },
    suspensions: { total: suspensions },
    recoveries: { total: recoveries },
  };
}

export async function getMembershipDashboard() {
  const metrics = await getMembershipMetrics();
  await generateMembershipOperationalAlerts();

  return {
    plans: metrics.plans,
    memberships: {
      active: metrics.memberships.active ?? 0,
      grace_period: metrics.memberships.grace_period ?? 0,
      in_dunning: metrics.memberships.in_dunning ?? 0,
      suspended: metrics.memberships.suspended ?? 0,
      cancelled: metrics.memberships.cancelled ?? 0,
    },
    payments: metrics.payments,
  };
}
