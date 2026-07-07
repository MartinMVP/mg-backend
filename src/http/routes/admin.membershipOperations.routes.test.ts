import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { MembershipChangeLog } from '../../domain/memberships/membershipChangeLog.model';
import { getMembershipMetrics } from '../../domain/memberships/membershipMetrics.service';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const benefits: MembershipBenefits = {
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

async function createPlan(code: string, price = 0) {
  return MembershipPlan.create({
    name: `Operations ${code}`,
    code,
    price,
    currency: 'MXN',
    billingPeriod: price > 0 ? 'monthly' : 'manual',
    benefits,
    isActive: true,
    isPublic: true,
    sortOrder: price,
    stripePriceId: price > 0 ? `price_${code}` : undefined,
  });
}

async function createMembership(user: any, plan: any, status = 'active', createdAt?: Date) {
  const now = new Date();
  const membership = await UserMembership.create({
    userId: user._id,
    planId: plan._id,
    status,
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    renewalMode: 'manual',
    source: 'admin',
    paymentProvider: 'none',
  });

  if (createdAt) {
    await UserMembership.updateOne({ _id: membership._id }, { $set: { createdAt } });
    membership.createdAt = createdAt;
  }

  return membership;
}

async function adminContext(role: 'admin' | 'super' = 'admin') {
  const user = await createTestUser(role);
  return { user, token: tokenFor(user, role) };
}

describe('membership admin operations', () => {
  it('dashboard returns metrics and requires admin role', async () => {
    const regular = await createTestUser('user');
    const { token } = await adminContext('admin');
    const free = await createPlan('free');
    const pro = await createPlan('pro', 499);
    const business = await createPlan('business', 999);
    const freeUser = await createTestUser();
    const proUser = await createTestUser();
    const businessUser = await createTestUser();
    await createMembership(freeUser, free, 'active');
    await createMembership(proUser, pro, 'grace_period');
    await createMembership(businessUser, business, 'suspended');
    await PaymentRecord.create({
      userId: proUser._id,
      membershipPlanId: pro._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      type: 'membership',
      status: 'succeeded',
      amount: pro.price,
      currency: 'MXN',
    });

    await request(app).get('/admin/membership/dashboard').expect(401);
    await request(app)
      .get('/admin/membership/dashboard')
      .set('Authorization', bearer(tokenFor(regular)))
      .expect(403);

    const res = await request(app)
      .get('/admin/membership/dashboard')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.body.plans).toMatchObject({ free: 1, pro: 1, business: 1 });
    expect(res.body.memberships).toMatchObject({ active: 1, grace_period: 1, suspended: 1 });
    expect(res.body.payments).toMatchObject({ succeeded: 1, failed: 0 });
  });

  it('lists subscriptions with filters, pagination, desc order and safe limit', async () => {
    const { token } = await adminContext();
    const pro = await createPlan('pro', 499);
    const business = await createPlan('business', 999);
    const firstUser = await createTestUser();
    const secondUser = await createTestUser();
    await createMembership(firstUser, pro, 'active', new Date('2026-01-01T00:00:00.000Z'));
    const newer = await createMembership(secondUser, business, 'cancelled', new Date('2026-01-02T00:00:00.000Z'));

    const byStatus = await request(app)
      .get('/admin/membership/subscriptions?status=cancelled&page=1&limit=200')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(byStatus.body.limit).toBe(100);
    expect(byStatus.body.items).toHaveLength(1);
    expect(String(byStatus.body.items[0]._id)).toBe(String(newer._id));

    const byEmail = await request(app)
      .get(`/admin/membership/subscriptions?email=${encodeURIComponent(secondUser.email)}`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(byEmail.body.items).toHaveLength(1);

    const byPlan = await request(app)
      .get('/admin/membership/subscriptions?plan=pro')
      .set('Authorization', bearer(token))
      .expect(200);
    expect((byPlan.body.items[0].planId as any).code).toBe('pro');
  });

  it('filters dunning, change logs and payment records with admin permissions', async () => {
    const regular = await createTestUser('user');
    const { token } = await adminContext();
    const user = await createTestUser();
    const pro = await createPlan('pro', 499);
    const membership = await createMembership(user, pro, 'grace_period');
    await DunningState.create({
      userId: user._id,
      userMembershipId: membership._id,
      status: 'active',
      failedAt: new Date(),
      retrySchedule: [],
    });
    await MembershipChangeLog.create({
      userId: user._id,
      userMembershipId: membership._id,
      fromPlanId: pro._id,
      toPlanId: pro._id,
      changeType: 'reactivation_completed',
      source: 'admin',
    });
    await PaymentRecord.create({
      userId: user._id,
      membershipPlanId: pro._id,
      userMembershipId: membership._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      type: 'membership',
      status: 'failed',
      amount: pro.price,
      currency: 'MXN',
      failedAt: new Date(),
    });

    await request(app)
      .get('/admin/payments/dunning')
      .set('Authorization', bearer(tokenFor(regular)))
      .expect(403);

    const dunning = await request(app)
      .get('/admin/payments/dunning?status=active&plan=pro')
      .set('Authorization', bearer(token))
      .expect(200);
    const changes = await request(app)
      .get('/admin/membership/change-logs?changeType=reactivation_completed&source=admin')
      .set('Authorization', bearer(token))
      .expect(200);
    const payments = await request(app)
      .get('/admin/payments/records?status=failed&provider=stripe&membershipPlan=pro')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(dunning.body.items).toHaveLength(1);
    expect(changes.body.items).toHaveLength(1);
    expect(payments.body.items).toHaveLength(1);
    expect(JSON.stringify(payments.body)).not.toContain('sk_');
  });

  it('cancels subscriptions through the canonical membership change flow', async () => {
    const { token } = await adminContext();
    const user = await createTestUser();
    const pro = await createPlan('pro-canonical-cancel', 499);
    const membership = await createMembership(user, pro, 'active');

    const res = await request(app)
      .post(`/admin/membership/subscriptions/${membership._id}/cancel`)
      .set('Authorization', bearer(token))
      .send({ reason: 'Admin requested cancellation' })
      .expect(200);

    const reloaded = await UserMembership.findById(membership._id);
    expect(res.body.scheduled).toBe(true);
    expect(reloaded?.status).toBe('active');
    expect(reloaded?.cancelAtPeriodEnd).toBe(true);
    expect(reloaded?.pendingChangeType).toBe('cancellation');
    expect(await MembershipChangeLog.exists({
      userId: user._id,
      userMembershipId: membership._id,
      changeType: 'cancellation_scheduled',
      source: 'admin',
    })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'MEMBERSHIP_CANCELLATION_SCHEDULED' })).toBeTruthy();
  });
  it('exports memberships as CSV for admins', async () => {
    const { token } = await adminContext('super');
    const user = await createTestUser();
    const free = await createPlan('free');
    await createMembership(user, free, 'active');

    await request(app)
      .get('/admin/membership/export')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(403);

    const res = await request(app)
      .get('/admin/membership/export')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('user,email,plan,status');
    expect(res.text).toContain(user.email);
    expect(res.text).toContain('free');
  });

  it('calculates conversions and internal operational alerts without external communications', async () => {
    const user = await createTestUser();
    const free = await createPlan('free');
    const pro = await createPlan('pro', 499);
    const membership = await createMembership(user, free, 'grace_period');
    await MembershipChangeLog.create({
      userId: user._id,
      userMembershipId: membership._id,
      fromPlanId: free._id,
      toPlanId: pro._id,
      changeType: 'upgrade_requested',
      source: 'user',
    });
    await MembershipChangeLog.create({
      userId: user._id,
      userMembershipId: membership._id,
      fromPlanId: pro._id,
      toPlanId: free._id,
      changeType: 'cancellation_completed',
      source: 'system',
    });
    await DunningState.create({
      userId: user._id,
      userMembershipId: membership._id,
      status: 'active',
      failedAt: new Date(),
      retrySchedule: [],
    });
    await PaymentRecord.create({
      userId: user._id,
      membershipPlanId: pro._id,
      userMembershipId: membership._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      type: 'membership',
      status: 'failed',
      amount: pro.price,
      currency: 'MXN',
    });

    const metrics = await getMembershipMetrics();
    await request(app)
      .get('/admin/membership/dashboard')
      .set('Authorization', bearer((await adminContext()).token))
      .expect(200);

    expect(metrics.conversions.free_to_pro).toBe(1);
    expect(metrics.cancellations.total).toBe(1);
    expect(await Audit.exists({ action: 'MEMBERSHIP_HIGH_DUNNING_RATE' })).toBeTruthy();
    expect(await Audit.exists({ action: 'MEMBERSHIP_HIGH_CANCELLATION_RATE' })).toBeTruthy();
    expect(await Audit.exists({ action: 'MEMBERSHIP_HIGH_PAYMENT_FAILURE_RATE' })).toBeTruthy();
  });
});
