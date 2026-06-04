import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipPlan, MembershipBenefits } from '../../domain/memberships/membershipPlan.model';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import {
  canCreateListing,
  ensureFreeMembershipForUser,
} from '../../domain/memberships/membership.service';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const defaultBenefits: MembershipBenefits = {
  maxActiveListings: 2,
  maxPhotosPerListing: 3,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

function planPayload(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return {
    name: `Plan ${suffix}`,
    code: `plan-${suffix}`,
    price: 0,
    currency: 'MXN',
    billingPeriod: 'manual',
    benefits: defaultBenefits,
    isActive: true,
    isPublic: true,
    sortOrder: 1,
    ...overrides,
  };
}

async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await createTestUser(role);
  return { token: signAccessToken({ sub: String(user._id), role, typ: 'access' }), user };
}

async function createPlan(overrides: Record<string, unknown> = {}) {
  return MembershipPlan.create(planPayload(overrides));
}

async function createMembership(userId: any, overrides: Record<string, unknown> = {}) {
  const plan = await createPlan();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60_000);

  const membership = await UserMembership.create({
    userId,
    planId: plan._id,
    status: 'active',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    renewalMode: 'manual',
    source: 'admin',
    paymentProvider: 'none',
    ...overrides,
  });

  return { membership, plan };
}

describe('membership domain foundation', () => {
  it('creates a valid MembershipPlan', async () => {
    const plan = await createPlan({ code: 'Pro-Visible' });

    expect(plan.code).toBe('pro-visible');
    expect(plan.currency).toBe('MXN');
    expect(plan.isActive).toBe(true);
    expect(plan.isPublic).toBe(true);
  });

  it('blocks duplicate plan code', async () => {
    await MembershipPlan.init();
    await createPlan({ code: 'duplicate-plan' });

    await expect(createPlan({ code: 'duplicate-plan' })).rejects.toMatchObject({ code: 11000 });
  });

  it('creates a valid UserMembership', async () => {
    const user = await createTestUser();
    const { membership } = await createMembership(user._id);

    expect(String(membership.userId)).toBe(String(user._id));
    expect(membership.status).toBe('active');
    expect(membership.paymentProvider).toBe('none');
  });

  it('prevents two operationally active memberships for one user', async () => {
    await UserMembership.init();
    const user = await createTestUser();
    await createMembership(user._id);

    await expect(createMembership(user._id)).rejects.toMatchObject({ code: 11000 });
  });

  it('creates MembershipUsage with non-negative counters', async () => {
    const user = await createTestUser();
    const { membership, plan } = await createMembership(user._id);

    const usage = await MembershipUsage.create({
      userId: user._id,
      membershipId: membership._id,
      planId: plan._id,
      periodStart: membership.currentPeriodStart,
      periodEnd: membership.currentPeriodEnd,
    });

    expect(usage.activeListingsCount).toBe(0);
    expect(usage.listingsCreatedThisPeriod).toBe(0);
    expect(usage.featuredListingsUsed).toBe(0);
  });

  it('rejects negative usage counters', async () => {
    const user = await createTestUser();
    const { membership, plan } = await createMembership(user._id);

    await expect(MembershipUsage.create({
      userId: user._id,
      membershipId: membership._id,
      planId: plan._id,
      activeListingsCount: -1,
      periodStart: membership.currentPeriodStart,
      periodEnd: membership.currentPeriodEnd,
    })).rejects.toBeTruthy();
  });

  it('register creates user with active Free membership and usage', async () => {
    const email = `member-${Date.now()}@mg.test`;

    const res = await request(app)
      .post('/auth/register')
      .send({ email, password: 'P4ssw0rd!', name: 'Member User' })
      .expect(201);

    const membership = await UserMembership.findOne({ userId: res.body.id });
    const plan = await MembershipPlan.findById(membership?.planId);
    const usage = await MembershipUsage.findOne({ membershipId: membership?._id });

    expect(membership?.status).toBe('active');
    expect(plan?.code).toBe('free');
    expect(usage).toBeTruthy();
  });

  it('ensureFreeMembershipForUser is idempotent and does not duplicate usage', async () => {
    const user = await createTestUser();
    const first = await ensureFreeMembershipForUser(user._id);
    const second = await ensureFreeMembershipForUser(user._id);

    expect(String(first.membership._id)).toBe(String(second.membership._id));
    expect(await UserMembership.countDocuments({ userId: user._id })).toBe(1);
    expect(await MembershipUsage.countDocuments({ membershipId: first.membership._id })).toBe(1);
  });

  it('legacy user receives Free membership on /account/membership', async () => {
    const user = await createTestUser();
    const token = signAccessToken({ sub: String(user._id), role: 'user', typ: 'access' });

    const res = await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.plan.code).toBe('free');
    expect(res.body.membership.status).toBe('active');
    expect(res.body.usage).toBeTruthy();
  });

  it('requires auth for /account/membership', async () => {
    await request(app).get('/account/membership').expect(401);
  });

  it('returns membership, plan, benefits and usage for account', async () => {
    const { token } = await authToken('user');

    const res = await request(app)
      .get('/account/membership')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.membership).toBeTruthy();
    expect(res.body.plan).toBeTruthy();
    expect(res.body.benefits).toBeTruthy();
    expect(res.body.usage).toBeTruthy();
  });

  it('user cannot create membership plan', async () => {
    const { token } = await authToken('user');

    await request(app)
      .post('/admin/membership/plans')
      .set('Authorization', bearer(token))
      .send(planPayload())
      .expect(403);
  });

  it('admin can create and edit membership plan', async () => {
    const { token } = await authToken('admin');

    const created = await request(app)
      .post('/admin/membership/plans')
      .set('Authorization', bearer(token))
      .send(planPayload({ code: 'admin-created' }))
      .expect(201);

    expect(created.body.code).toBe('admin-created');

    const updated = await request(app)
      .patch(`/admin/membership/plans/${created.body._id}`)
      .set('Authorization', bearer(token))
      .send({ name: 'Admin Updated' })
      .expect(200);

    expect(updated.body.name).toBe('Admin Updated');
  });

  it('admin can list memberships and view one membership', async () => {
    const { token } = await authToken('admin');
    const user = await createTestUser();
    const { membership } = await createMembership(user._id);

    const list = await request(app)
      .get('/admin/membership/subscriptions')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(list.body.items.length).toBeGreaterThan(0);

    const detail = await request(app)
      .get(`/admin/membership/subscriptions/${membership._id}`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(String(detail.body.membership._id)).toBe(String(membership._id));
  });

  it('admin can suspend and cancel memberships', async () => {
    const { token } = await authToken('admin');
    const user = await createTestUser();
    const { membership } = await createMembership(user._id);

    const suspended = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/suspend`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(suspended.body.status).toBe('suspended');

    const cancelled = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/cancel`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(cancelled.body.status).toBe('cancelled');
  });

  it('admin can activate membership when user has no other active membership', async () => {
    const { token } = await authToken('admin');
    const user = await createTestUser();
    const { membership } = await createMembership(user._id, { status: 'pending_payment' });

    const res = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/activate`)
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.status).toBe('active');
  });

  it('activate respects one active membership per user', async () => {
    const { token } = await authToken('admin');
    const user = await createTestUser();
    await createMembership(user._id);
    const pending = await createMembership(user._id, { status: 'pending_payment' });

    await request(app)
      .post(`/admin/membership/subscriptions/${pending.membership._id}/activate`)
      .set('Authorization', bearer(token))
      .expect(409);
  });

  it('canCreateListing returns true while usage is under plan limit', async () => {
    const user = await createTestUser();
    await ensureFreeMembershipForUser(user._id);

    expect(await canCreateListing(user._id)).toBe(true);
  });

  it('canCreateListing returns false when usage reaches plan limit', async () => {
    const user = await createTestUser();
    const { membership, usage } = await ensureFreeMembershipForUser(user._id);
    usage.activeListingsCount = 1;
    await usage.save();

    expect(await canCreateListing(user._id)).toBe(false);
    expect(await Audit.exists({ actor: String(user._id), action: 'MEMBERSHIP_LIMIT_REACHED' })).toBeTruthy();
    expect(String(membership.userId)).toBe(String(user._id));
  });

  it('suspended and expired memberships do not grant benefits', async () => {
    const suspendedUser = await createTestUser();
    await createMembership(suspendedUser._id, { status: 'suspended' });
    expect(await canCreateListing(suspendedUser._id)).toBe(false);

    const expiredUser = await createTestUser();
    await createMembership(expiredUser._id, { status: 'expired' });
    expect(await canCreateListing(expiredUser._id)).toBe(false);
  });
});
