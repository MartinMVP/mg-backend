import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan, MembershipBenefits } from './membershipPlan.model';
import { MembershipUsage } from './membershipUsage.model';
import {
  MembershipStatus,
  operationallyActiveMembershipStatuses,
  UserMembership,
} from './userMembership.model';
import { membershipAuditActions } from './membership.audit';
import { ensureDefaultMembershipPlans } from './membership.seed';

const freePeriodMs = 365 * 24 * 60 * 60_000;

function toObjectId(id: string | Types.ObjectId) {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function isActiveStatus(status: MembershipStatus) {
  return operationallyActiveMembershipStatuses.includes(status);
}

export async function ensureMembershipUsageForPeriod(membership: any) {
  return MembershipUsage.findOneAndUpdate(
    {
      membershipId: membership._id,
      periodStart: membership.currentPeriodStart,
      periodEnd: membership.currentPeriodEnd,
    },
    {
      $setOnInsert: {
        userId: membership.userId,
        membershipId: membership._id,
        planId: membership.planId,
        activeListingsCount: 0,
        listingsCreatedThisPeriod: 0,
        featuredListingsUsed: 0,
        periodStart: membership.currentPeriodStart,
        periodEnd: membership.currentPeriodEnd,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

export async function ensureFreeMembershipForUser(userId: string | Types.ObjectId) {
  const userObjectId = toObjectId(userId);
  let membership = await UserMembership.findOne({
    userId: userObjectId,
    status: { $in: operationallyActiveMembershipStatuses },
  }).sort({ createdAt: -1 });

  if (membership) {
    const plan = await MembershipPlan.findById(membership.planId);
    const usage = await ensureMembershipUsageForPeriod(membership);
    return { membership, plan, usage, created: false };
  }

  const existingMembership = await UserMembership.findOne({ userId: userObjectId }).sort({ createdAt: -1 });
  if (existingMembership) {
    const plan = await MembershipPlan.findById(existingMembership.planId);
    const usage = await ensureMembershipUsageForPeriod(existingMembership);
    return { membership: existingMembership, plan, usage, created: false };
  }

  const freePlan = await ensureDefaultMembershipPlans();
  if (!freePlan) throw new Error('Free membership plan is not available');

  const now = new Date();
  const periodEnd = new Date(now.getTime() + freePeriodMs);

  try {
    membership = await UserMembership.create({
      userId: userObjectId,
      planId: freePlan._id,
      status: 'active',
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      renewalMode: 'manual',
      source: 'migration',
      paymentProvider: 'none',
    });

    await Audit.create({ actor: String(userObjectId), action: membershipAuditActions.created });
    await Audit.create({ actor: String(userObjectId), action: membershipAuditActions.freeAssigned });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    membership = await UserMembership.findOne({
      userId: userObjectId,
      status: { $in: operationallyActiveMembershipStatuses },
    }).sort({ createdAt: -1 });
    if (!membership) throw error;
  }

  const usage = await ensureMembershipUsageForPeriod(membership);
  return { membership, plan: freePlan, usage, created: true };
}

export async function getUserMembership(userId: string | Types.ObjectId) {
  const ensured = await ensureFreeMembershipForUser(userId);
  const plan = ensured.plan || await MembershipPlan.findById(ensured.membership.planId);
  const usage = ensured.usage || await ensureMembershipUsageForPeriod(ensured.membership);

  return { membership: ensured.membership, plan, benefits: plan?.benefits || null, usage };
}

export async function getUserMembershipBenefits(userId: string | Types.ObjectId): Promise<MembershipBenefits | null> {
  const { membership, plan } = await getUserMembership(userId);
  if (!membership || !plan || !isActiveStatus(membership.status)) return null;
  return plan.benefits;
}

export async function getUserMembershipUsage(userId: string | Types.ObjectId) {
  const { usage } = await getUserMembership(userId);
  return usage;
}

export async function canCreateListing(userId: string | Types.ObjectId) {
  const { membership, plan, usage } = await getUserMembership(userId);
  if (!membership || !plan || !usage || !isActiveStatus(membership.status)) {
    await Audit.create({ actor: String(userId), action: membershipAuditActions.limitReached });
    return false;
  }

  const allowed = usage.activeListingsCount < plan.benefits.maxActiveListings;
  if (!allowed) await Audit.create({ actor: String(userId), action: membershipAuditActions.limitReached });
  return allowed;
}

export async function canUseFeaturedListing(userId: string | Types.ObjectId) {
  const { membership, plan, usage } = await getUserMembership(userId);
  if (!membership || !plan || !usage || !isActiveStatus(membership.status)) return false;
  if (!plan.benefits.canUseFeaturedListings) return false;
  return usage.featuredListingsUsed < plan.benefits.includedFeaturedListings;
}
