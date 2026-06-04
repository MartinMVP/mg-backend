import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { membershipAuditActions } from './membership.audit';
import { MembershipUsage } from './membershipUsage.model';
import { getUserMembership } from './membership.service';
import { MembershipStatus } from './userMembership.model';

const benefitGrantingStatuses: MembershipStatus[] = ['active', 'grace_period', 'in_dunning'];

function canUseBenefits(status: MembershipStatus) {
  return benefitGrantingStatuses.includes(status);
}

function toCapacity(activeListings: number, maxActiveListings: number) {
  return {
    activeListings,
    maxActiveListings,
    remaining: Math.max(0, maxActiveListings - activeListings),
  };
}

export async function getMembershipCapacity(userId: string | Types.ObjectId) {
  const { membership, plan, usage } = await getUserMembership(userId);
  const activeListings = usage?.activeListingsCount ?? 0;
  const maxActiveListings = plan?.benefits.maxActiveListings ?? 0;

  return {
    membership,
    plan,
    usage,
    grantsBenefits: Boolean(membership && canUseBenefits(membership.status)),
    ...toCapacity(activeListings, maxActiveListings),
  };
}

export async function getRemainingListingCapacity(userId: string | Types.ObjectId) {
  const capacity = await getMembershipCapacity(userId);
  return capacity.grantsBenefits ? capacity.remaining : 0;
}

export async function canCreateListing(userId: string | Types.ObjectId) {
  const capacity = await getMembershipCapacity(userId);
  const allowed = capacity.grantsBenefits && capacity.remaining > 0;

  if (!allowed) {
    await Audit.create({
      actor: String(userId),
      action: membershipAuditActions.limitReached,
      payload: {
        membershipId: capacity.membership?._id,
        planId: capacity.plan?._id,
        activeListings: capacity.activeListings,
        maxActiveListings: capacity.maxActiveListings,
        remaining: 0,
      },
    });
  }

  return {
    allowed,
    ...capacity,
    remaining: allowed ? capacity.remaining : 0,
  };
}

export async function consumeListingSlot(userId: string | Types.ObjectId) {
  const capacity = await getMembershipCapacity(userId);
  if (!capacity.membership || !capacity.plan || !capacity.usage || !capacity.grantsBenefits) {
    await Audit.create({
      actor: String(userId),
      action: membershipAuditActions.limitReached,
      payload: {
        membershipId: capacity.membership?._id,
        planId: capacity.plan?._id,
        activeListings: capacity.activeListings,
        maxActiveListings: capacity.maxActiveListings,
        remaining: 0,
      },
    });
    return { consumed: false, ...capacity, remaining: 0 };
  }

  const updatedUsage = await MembershipUsage.findOneAndUpdate(
    {
      _id: capacity.usage._id,
      activeListingsCount: { $lt: capacity.maxActiveListings },
    },
    {
      $inc: {
        activeListingsCount: 1,
        listingsCreatedThisPeriod: 1,
      },
    },
    { new: true, runValidators: true }
  );

  if (!updatedUsage) {
    await Audit.create({
      actor: String(userId),
      action: membershipAuditActions.limitReached,
      payload: {
        membershipId: capacity.membership._id,
        planId: capacity.plan._id,
        activeListings: capacity.activeListings,
        maxActiveListings: capacity.maxActiveListings,
        remaining: 0,
      },
    });
    return { consumed: false, ...capacity, remaining: 0 };
  }

  await Audit.create({
    actor: String(userId),
    action: membershipAuditActions.capacityConsumed,
    payload: {
      membershipId: capacity.membership._id,
      planId: capacity.plan._id,
      usageId: updatedUsage._id,
      activeListings: updatedUsage.activeListingsCount,
      maxActiveListings: capacity.maxActiveListings,
      remaining: Math.max(0, capacity.maxActiveListings - updatedUsage.activeListingsCount),
    },
  });

  return {
    consumed: true,
    membership: capacity.membership,
    plan: capacity.plan,
    usage: updatedUsage,
    grantsBenefits: capacity.grantsBenefits,
    ...toCapacity(updatedUsage.activeListingsCount, capacity.maxActiveListings),
  };
}

export async function releaseListingSlot(userId: string | Types.ObjectId) {
  const capacity = await getMembershipCapacity(userId);
  if (!capacity.usage) return { released: false, ...capacity };

  const updatedUsage = await MembershipUsage.findOneAndUpdate(
    {
      _id: capacity.usage._id,
      activeListingsCount: { $gt: 0 },
    },
    {
      $inc: {
        activeListingsCount: -1,
      },
    },
    { new: true, runValidators: true }
  );

  if (!updatedUsage) return { released: false, ...capacity };

  await Audit.create({
    actor: String(userId),
    action: membershipAuditActions.capacityReleased,
    payload: {
      membershipId: capacity.membership?._id,
      planId: capacity.plan?._id,
      usageId: updatedUsage._id,
      activeListings: updatedUsage.activeListingsCount,
      maxActiveListings: capacity.maxActiveListings,
      remaining: Math.max(0, capacity.maxActiveListings - updatedUsage.activeListingsCount),
    },
  });

  return {
    released: true,
    membership: capacity.membership,
    plan: capacity.plan,
    usage: updatedUsage,
    grantsBenefits: capacity.grantsBenefits,
    ...toCapacity(updatedUsage.activeListingsCount, capacity.maxActiveListings),
  };
}
