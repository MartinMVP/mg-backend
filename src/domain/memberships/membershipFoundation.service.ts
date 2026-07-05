import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Notification } from '../notifications/notification.model';
import { MembershipPlan, MembershipBenefits } from './membershipPlan.model';
import { MembershipBenefit, MembershipBenefitFeature, membershipBenefitFeatures } from './membershipBenefit.model';
import { MembershipHistory } from './membershipHistory.model';
import { UserMembership } from './userMembership.model';
import { membershipAuditActions } from './membership.audit';
import { ensureMembershipUsageForPeriod } from './membership.service';

const dayMs = 24 * 60 * 60_000;

const defaultBenefits: MembershipBenefits = {
  maxActiveListings: 0,
  maxPhotosPerListing: 0,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

export type BenefitOperation = 'grant' | 'consume' | 'release' | 'expire' | 'validate';

function toObjectId(id: string | Types.ObjectId) {
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function requireObjectId(id: string, label: string) {
  if (!Types.ObjectId.isValid(id)) throw new Error(`invalid_${label}`);
  return new Types.ObjectId(id);
}

function normalizePlanPayload(body: any) {
  const monthlyPrice = Math.max(0, Number(body.monthlyPrice ?? body.price ?? 0));
  const yearlyPrice = Math.max(0, Number(body.yearlyPrice ?? monthlyPrice * 12));
  const durationDays = Math.max(1, Number(body.durationDays ?? 30));
  const limits = body.limits && typeof body.limits === 'object' ? body.limits : {};
  const benefits = body.benefits && !Array.isArray(body.benefits)
    ? { ...defaultBenefits, ...body.benefits }
    : buildLegacyBenefits(limits);

  return {
    name: String(body.name || '').trim(),
    code: String(body.code || '').trim().toLowerCase(),
    description: body.description ? String(body.description).trim() : undefined,
    monthlyPrice,
    yearlyPrice,
    durationDays,
    price: monthlyPrice,
    currency: 'MXN' as const,
    billingPeriod: 'manual' as const,
    benefits,
    limits,
    isActive: body.isActive ?? true,
    isPublic: body.isPublic ?? false,
    sortOrder: Number(body.sortOrder ?? 0),
  };
}

function buildLegacyBenefits(limits: Record<string, unknown>): MembershipBenefits {
  const animalListings = Number(limits.animalListings ?? limits.animal_listings ?? 0);
  const mediaUploads = Number(limits.mediaUploads ?? limits.media_uploads ?? 0);
  const featured = Number(limits.featuredPublications ?? limits.featured_publications ?? 0);
  return {
    maxActiveListings: Math.max(0, animalListings),
    maxPhotosPerListing: Math.max(0, mediaUploads),
    canUseFeaturedListings: featured > 0,
    includedFeaturedListings: Math.max(0, featured),
    canAccessAuctions: Number(limits.auctionListings ?? limits.auction_listings ?? 0) > 0,
    canAccessMetrics: false,
    supportLevel: 'basic',
  };
}

function buildBenefitLimits(plan: any): Array<{ feature: MembershipBenefitFeature; limit: number; isUnlimited: boolean }> {
  const limits = plan.limits || {};
  return [
    ['animal_listings', limits.animalListings ?? limits.animal_listings ?? plan.benefits?.maxActiveListings ?? 0],
    ['auction_listings', limits.auctionListings ?? limits.auction_listings ?? (plan.benefits?.canAccessAuctions ? 1 : 0)],
    ['media_uploads', limits.mediaUploads ?? limits.media_uploads ?? plan.benefits?.maxPhotosPerListing ?? 0],
    ['messaging', limits.messaging ?? 0],
    ['featured_publications', limits.featuredPublications ?? limits.featured_publications ?? plan.benefits?.includedFeaturedListings ?? 0],
  ].map(([feature, value]) => ({
    feature: feature as MembershipBenefitFeature,
    limit: Number(value) < 0 ? 0 : Number(value),
    isUnlimited: Number(value) < 0,
  }));
}

async function recordHistory(input: {
  membershipId: Types.ObjectId;
  userId: Types.ObjectId;
  action: string;
  fromStatus?: string;
  toStatus?: string;
  actor?: string;
  metadata?: Record<string, unknown>;
}) {
  await MembershipHistory.create(input);
}

async function audit(actor: string | undefined, action: string) {
  await Audit.create({ actor: actor || 'system', action });
}

async function notify(userId: Types.ObjectId, type: any, title: string, message: string) {
  await Notification.create({ userId, type, title, message, read: false });
}

export async function createMembershipPlan(body: any, actor?: string) {
  const payload = normalizePlanPayload(body);
  if (!payload.name || !payload.code) throw new Error('membership_plan_required_fields');
  const plan = await MembershipPlan.create(payload);
  await audit(actor, membershipAuditActions.planCreated);
  return plan;
}

export async function updateMembershipPlan(id: string, body: any, actor?: string) {
  const planId = requireObjectId(id, 'membership_plan_id');
  const payload = normalizePlanPayload({ ...body, code: body.code ?? undefined, name: body.name ?? undefined });
  const update: Record<string, unknown> = {};
  for (const key of ['name', 'code', 'description', 'monthlyPrice', 'yearlyPrice', 'durationDays', 'price', 'benefits', 'limits', 'isActive', 'isPublic', 'sortOrder']) {
    if (body[key] !== undefined || (key === 'price' && (body.monthlyPrice !== undefined || body.price !== undefined))) update[key] = (payload as any)[key];
  }
  const plan = await MembershipPlan.findByIdAndUpdate(planId, { $set: update }, { new: true, runValidators: true });
  if (!plan) throw new Error('membership_plan_not_found');
  await audit(actor, membershipAuditActions.planUpdated);
  return plan;
}

export async function setMembershipPlanActive(id: string, isActive: boolean, actor?: string) {
  const plan = await MembershipPlan.findByIdAndUpdate(requireObjectId(id, 'membership_plan_id'), { $set: { isActive } }, { new: true });
  if (!plan) throw new Error('membership_plan_not_found');
  await audit(actor, membershipAuditActions.planUpdated);
  return plan;
}

export async function createMembership(input: { userId: string; planId: string; startsAt?: string | Date; metadata?: Record<string, unknown> }, actor?: string) {
  const plan = await MembershipPlan.findById(requireObjectId(input.planId, 'plan_id'));
  if (!plan) throw new Error('membership_plan_not_found');
  const startsAt = input.startsAt ? new Date(input.startsAt) : new Date();
  const expiresAt = new Date(startsAt.getTime() + Number(plan.durationDays ?? 30) * dayMs);
  const membership = await UserMembership.create({
    userId: requireObjectId(input.userId, 'user_id'),
    planId: plan._id,
    status: 'pending_activation',
    startsAt,
    currentPeriodStart: startsAt,
    currentPeriodEnd: expiresAt,
    expiresAt,
    renewalMode: 'manual',
    source: 'admin',
    paymentProvider: 'none',
    metadata: input.metadata || {},
  });
  await recordHistory({ membershipId: membership._id, userId: membership.userId, action: 'created', toStatus: membership.status, actor });
  await audit(actor, membershipAuditActions.created);
  await notify(membership.userId, 'membership_created', 'Membresía creada', 'Tu membresía fue creada por administración.');
  return membership;
}

export async function activateMembership(id: string, actor?: string) {
  const membership = await UserMembership.findById(requireObjectId(id, 'membership_id'));
  if (!membership) throw new Error('membership_not_found');
  if (!['draft', 'pending_activation', 'pending_payment', 'suspended'].includes(membership.status)) throw new Error('membership_cannot_activate');
  const existingActive = await UserMembership.findOne({ _id: { $ne: membership._id }, userId: membership.userId, status: 'active' });
  if (existingActive) throw new Error('active_membership_exists');
  const fromStatus = membership.status;
  membership.status = 'active';
  membership.activatedAt = new Date();
  membership.suspendedAt = undefined;
  await membership.save();
  await ensureMembershipUsageForPeriod(membership);
  await grantMembershipBenefits(membership._id, actor);
  await recordHistory({ membershipId: membership._id, userId: membership.userId, action: 'activated', fromStatus, toStatus: membership.status, actor });
  await audit(actor, membershipAuditActions.activated);
  await notify(membership.userId, 'membership_activated', 'Membresía activada', 'Tu membresía fue activada.');
  return membership;
}

export async function suspendMembership(id: string, actor?: string) {
  return transitionMembership(id, ['active'], 'suspended', 'suspended', membershipAuditActions.suspended, actor, 'membership_suspended');
}

export async function reactivateFoundationMembership(id: string, actor?: string) {
  return activateMembership(id, actor);
}

export async function cancelMembership(id: string, actor?: string) {
  return transitionMembership(id, ['active', 'suspended', 'pending_activation', 'expired'], 'cancelled', 'cancelled', membershipAuditActions.cancelled, actor, undefined, { cancelledAt: new Date() });
}

export async function expireMembership(id: string, actor?: string) {
  const membership = await transitionMembership(id, ['active'], 'expired', 'expired', membershipAuditActions.expired, actor, 'membership_expired', { expiresAt: new Date() });
  await expireMembershipBenefits(membership._id, actor);
  return membership;
}

async function transitionMembership(
  id: string,
  from: string[],
  to: any,
  action: string,
  auditAction: string,
  actor?: string,
  notificationType?: any,
  extra: Record<string, unknown> = {}
) {
  const membership = await UserMembership.findById(requireObjectId(id, 'membership_id'));
  if (!membership) throw new Error('membership_not_found');
  if (!from.includes(membership.status)) throw new Error(`membership_cannot_${action}`);
  const fromStatus = membership.status;
  membership.status = to;
  Object.assign(membership, extra);
  if (to === 'suspended') membership.suspendedAt = new Date();
  await membership.save();
  await recordHistory({ membershipId: membership._id, userId: membership.userId, action, fromStatus, toStatus: to, actor });
  await audit(actor, auditAction);
  if (notificationType) await notify(membership.userId, notificationType, `Membresía ${action}`, `Tu membresía fue marcada como ${to}.`);
  return membership;
}

export async function grantMembershipBenefits(membershipId: string | Types.ObjectId, actor?: string) {
  const membership = await UserMembership.findById(toObjectId(membershipId)).populate('planId');
  if (!membership) throw new Error('membership_not_found');
  const plan = membership.planId as any;
  const benefits = await Promise.all(buildBenefitLimits(plan).map((benefit) => MembershipBenefit.findOneAndUpdate(
    { membershipId: membership._id, feature: benefit.feature },
    { $setOnInsert: { planId: plan._id, userId: membership.userId, expiresAt: membership.expiresAt }, $set: benefit },
    { upsert: true, new: true, runValidators: true }
  )));
  await audit(actor, membershipAuditActions.benefitGranted);
  return benefits;
}

export async function consumeMembershipBenefit(membershipId: string | Types.ObjectId, feature: MembershipBenefitFeature, amount = 1, actor?: string) {
  if (!membershipBenefitFeatures.includes(feature)) throw new Error('membership_benefit_not_supported');
  const benefit = await MembershipBenefit.findOne({ membershipId: toObjectId(membershipId), feature });
  if (!benefit) throw new Error('membership_benefit_not_found');
  if (!benefit.isUnlimited && benefit.consumed + amount > benefit.limit) throw new Error('membership_benefit_limit_reached');
  benefit.consumed += amount;
  await benefit.save();
  await audit(actor, membershipAuditActions.benefitConsumed);
  return benefit;
}

export async function releaseMembershipBenefit(membershipId: string | Types.ObjectId, feature: MembershipBenefitFeature, amount = 1) {
  const benefit = await MembershipBenefit.findOne({ membershipId: toObjectId(membershipId), feature });
  if (!benefit) throw new Error('membership_benefit_not_found');
  benefit.consumed = Math.max(0, benefit.consumed - amount);
  await benefit.save();
  return benefit;
}

export async function expireMembershipBenefits(membershipId: string | Types.ObjectId, actor?: string) {
  await MembershipBenefit.updateMany({ membershipId: toObjectId(membershipId) }, { $set: { expiresAt: new Date() } });
  await audit(actor, 'BENEFIT_EXPIRED');
}

export async function validateMembershipBenefit(membershipId: string | Types.ObjectId, feature: MembershipBenefitFeature) {
  const benefit = await MembershipBenefit.findOne({ membershipId: toObjectId(membershipId), feature }).lean();
  if (!benefit) return { allowed: false, reason: 'membership_benefit_not_found' };
  if (benefit.expiresAt && benefit.expiresAt <= new Date()) return { allowed: false, reason: 'membership_benefit_expired' };
  if (!benefit.isUnlimited && benefit.consumed >= benefit.limit) return { allowed: false, reason: 'membership_benefit_limit_reached' };
  return { allowed: true, benefit };
}

export async function operateMembershipBenefit(input: {
  operation: BenefitOperation;
  membershipId: string;
  feature: MembershipBenefitFeature;
  amount?: number;
  actor?: string;
}) {
  if (input.operation === 'grant') return grantMembershipBenefits(input.membershipId, input.actor);
  if (input.operation === 'consume') return consumeMembershipBenefit(input.membershipId, input.feature, input.amount ?? 1, input.actor);
  if (input.operation === 'release') return releaseMembershipBenefit(input.membershipId, input.feature, input.amount ?? 1);
  if (input.operation === 'expire') return expireMembershipBenefits(input.membershipId, input.actor);
  return validateMembershipBenefit(input.membershipId, input.feature);
}

export async function listMembershipHistory(id: string) {
  return MembershipHistory.find({ membershipId: requireObjectId(id, 'membership_id') }).sort({ createdAt: -1 }).lean();
}
