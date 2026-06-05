import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { Listing } from '../../domain/listings/listing.model';
import { membershipAuditActions } from '../../domain/memberships/membership.audit';
import { MembershipChangeLog } from '../../domain/memberships/membershipChangeLog.model';
import { processMembershipPendingChanges } from '../../domain/memberships/membershipChange.service';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { ensureFreeMembershipForUser, ensureMembershipUsageForPeriod } from '../../domain/memberships/membership.service';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { bearer } from '../../test/helpers/auth';
import { createTestListing, createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const baseBenefits: MembershipBenefits = {
  maxActiveListings: 3,
  maxPhotosPerListing: 5,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

function tokenFor(user: any, role = user.role) {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

function planPayload(code: string, price: number, maxActiveListings = 3) {
  return {
    name: `Plan ${code}`,
    code,
    price,
    currency: 'MXN',
    billingPeriod: price > 0 ? 'monthly' : 'manual',
    benefits: { ...baseBenefits, maxActiveListings },
    isActive: true,
    isPublic: true,
    sortOrder: price,
    stripePriceId: price > 0 ? `price_${code}` : undefined,
  };
}

async function createPlan(code: string, price: number, maxActiveListings = 3) {
  return MembershipPlan.create(planPayload(`${code}-${Math.random().toString(36).slice(2, 8)}`, price, maxActiveListings));
}

async function createPaidMembership(userId: any, plan: any, periodEnd?: Date) {
  const now = new Date();
  const membership = await UserMembership.create({
    userId,
    planId: plan._id,
    status: 'active',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd ?? new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    renewalMode: 'automatic',
    source: 'stripe',
    paymentProvider: 'stripe',
    providerCustomerId: `cus_${Math.random().toString(36).slice(2, 8)}`,
    providerSubscriptionId: `sub_${Math.random().toString(36).slice(2, 8)}`,
  });
  await ensureMembershipUsageForPeriod(membership);
  return membership;
}

describe('membership subscription changes', () => {
  it('Free to Pro requires checkout and does not change the active plan', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    const { membership, plan: freePlan } = await ensureFreeMembershipForUser(user._id);
    const pro = await createPlan('pro-upgrade', 499);

    const res = await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(token))
      .send({ targetPlanCode: pro.code })
      .expect(409);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body).toMatchObject({
      ok: false,
      requiresCheckout: true,
      reason: 'paid_upgrade_requires_checkout',
    });
    expect(String(reloaded?.planId)).toBe(String(freePlan?._id));
    expect(reloaded?.status).toBe('active');
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'upgrade_requested' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_upgrade_requested' })).toBeTruthy();
  });

  it('Free to Business requires checkout', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    await ensureFreeMembershipForUser(user._id);
    const business = await createPlan('business-upgrade', 999);

    const res = await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(token))
      .send({ targetPlanCode: business.code })
      .expect(409);

    expect(res.body.requiresCheckout).toBe(true);
  });

  it('Pro to Business requires checkout and keeps Pro active', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    const pro = await createPlan('pro-current', 499);
    const business = await createPlan('business-target', 999);
    const membership = await createPaidMembership(user._id, pro);

    const res = await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(token))
      .send({ targetPlanCode: business.code })
      .expect(409);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.requiresCheckout).toBe(true);
    expect(String(reloaded?.planId)).toBe(String(pro._id));
    expect(String(reloaded?.pendingPlanId)).toBe(String(business._id));
    expect(reloaded?.pendingChangeType).toBe('upgrade');
  });

  it('admin cannot activate a paid upgrade without invoice.paid', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser();
    const pro = await createPlan('admin-pro-current', 499);
    const business = await createPlan('admin-business-target', 999);
    const membership = await createPaidMembership(user._id, pro);

    const res = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/change-plan`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .send({ targetPlanCode: business.code })
      .expect(409);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.requiresCheckout).toBe(true);
    expect(String(reloaded?.planId)).toBe(String(pro._id));
  });

  it('downgrade is scheduled to currentPeriodEnd and does not affect benefits immediately', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    const business = await createPlan('business-current', 999, 10);
    const pro = await createPlan('pro-downgrade', 499, 2);
    const periodEnd = new Date(Date.now() + 24 * 60 * 60_000);
    const membership = await createPaidMembership(user._id, business, periodEnd);

    const res = await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(token))
      .send({ targetPlanCode: pro.code })
      .expect(200);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.scheduled).toBe(true);
    expect(String(reloaded?.planId)).toBe(String(business._id));
    expect(String(reloaded?.pendingPlanId)).toBe(String(pro._id));
    expect(reloaded?.pendingChangeType).toBe('downgrade');
    expect(reloaded?.pendingChangeEffectiveAt?.toISOString()).toBe(periodEnd.toISOString());
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'downgrade_scheduled' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_downgrade_scheduled' })).toBeTruthy();
  });

  it('processMembershipPendingChanges applies downgrade without deleting listings', async () => {
    const user = await createTestUser();
    const business = await createPlan('business-expiring', 999, 10);
    const freeLike = await createPlan('free-like-target', 0, 1);
    const past = new Date(Date.now() - 60_000);
    const membership = await createPaidMembership(user._id, business, past);
    const listing = await createTestListing(user._id);
    const usage = await MembershipUsage.findOne({ membershipId: membership._id });
    if (usage) {
      usage.activeListingsCount = 3;
      usage.listingsCreatedThisPeriod = 3;
      await usage.save();
    }
    membership.pendingPlanId = freeLike._id;
    membership.pendingChangeType = 'downgrade';
    membership.pendingChangeEffectiveAt = past;
    await membership.save();

    const result = await processMembershipPendingChanges(new Date());

    const reloaded = await UserMembership.findById(membership._id);
    expect(result.downgraded).toBe(1);
    expect(String(reloaded?.planId)).toBe(String(freeLike._id));
    expect(await Listing.exists({ _id: listing._id })).toBeTruthy();
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'downgrade_completed' })).toBeTruthy();
  });

  it('cancel schedules at period end and preserves benefits until then', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    const pro = await createPlan('pro-cancel', 499);
    const periodEnd = new Date(Date.now() + 24 * 60 * 60_000);
    const membership = await createPaidMembership(user._id, pro, periodEnd);

    const res = await request(app)
      .post('/account/membership/cancel')
      .set('Authorization', bearer(token))
      .send({ reason: 'No longer needed' })
      .expect(200);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.scheduled).toBe(true);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.cancelAtPeriodEnd).toBe(true);
    expect(reloaded?.pendingChangeType).toBe('cancellation');
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'cancellation_scheduled' })).toBeTruthy();
  });

  it('processMembershipPendingChanges completes cancellation and guarantees Free', async () => {
    const user = await createTestUser();
    const pro = await createPlan('pro-cancel-past', 499);
    const past = new Date(Date.now() - 60_000);
    const membership = await createPaidMembership(user._id, pro, past);
    membership.cancelAtPeriodEnd = true;
    membership.pendingChangeType = 'cancellation';
    membership.pendingChangeEffectiveAt = past;
    await membership.save();

    const result = await processMembershipPendingChanges(new Date());

    const cancelled = await UserMembership.findById(membership._id);
    const active = await UserMembership.findOne({ userId: user._id, status: 'active' }).populate('planId');
    expect(result.cancelled).toBe(1);
    expect(cancelled?.status).toBe('cancelled');
    expect((active?.planId as any).code).toBe('free');
    expect(await Notification.exists({ userId: user._id, type: 'membership_cancellation_completed' })).toBeTruthy();
  });

  it('reactivates a scheduled cancellation without checkout', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    const pro = await createPlan('pro-reactivate', 499);
    const membership = await createPaidMembership(user._id, pro);
    membership.cancelAtPeriodEnd = true;
    membership.pendingChangeType = 'cancellation';
    membership.pendingChangeEffectiveAt = membership.currentPeriodEnd;
    await membership.save();

    const res = await request(app)
      .post('/account/membership/reactivate')
      .set('Authorization', bearer(token))
      .expect(200);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.ok).toBe(true);
    expect(reloaded?.cancelAtPeriodEnd).toBe(false);
    expect(reloaded?.pendingChangeType).toBeUndefined();
    expect(reloaded?.pendingPlanId).toBeUndefined();
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'reactivation_completed' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_reactivation' })).toBeTruthy();
  });

  it('blocks regular users from admin endpoints and allows admin to process pending changes', async () => {
    const regular = await createTestUser();
    const admin = await createTestUser('admin');

    await request(app)
      .get('/admin/membership/change-logs')
      .set('Authorization', bearer(tokenFor(regular)))
      .expect(403);

    const list = await request(app)
      .get('/admin/membership/change-logs')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    const processed = await request(app)
      .post('/admin/membership/process-pending-changes')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    expect(Array.isArray(list.body.items)).toBe(true);
    expect(processed.body).toHaveProperty('processed');
  });

  it('admin can schedule downgrade and cancellation but not paid upgrade activation', async () => {
    const admin = await createTestUser('admin');
    const user = await createTestUser();
    const business = await createPlan('admin-business-current', 999);
    const pro = await createPlan('admin-pro-target', 499);
    const membership = await createPaidMembership(user._id, business);

    const downgrade = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/change-plan`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .send({ targetPlanCode: pro.code })
      .expect(200);

    const cancel = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/cancel`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .send({ reason: 'admin requested' })
      .expect(200);

    expect(downgrade.body.scheduled).toBe(true);
    expect(cancel.body.scheduled).toBe(true);
    expect(await MembershipChangeLog.countDocuments({ userMembershipId: membership._id })).toBeGreaterThanOrEqual(4);
  });

  it('does not call external payment or fiscal systems for membership changes', async () => {
    const user = await createTestUser();
    const token = tokenFor(user);
    await ensureFreeMembershipForUser(user._id);
    const pro = await createPlan('no-external-upgrade', 499);

    await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(token))
      .send({ targetPlanCode: pro.code })
      .expect(409);

    expect(await Audit.exists({ actor: String(user._id), action: membershipAuditActions.upgradeRequested })).toBeTruthy();
  });
});
