import { createHmac } from 'crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { processDunningDue, startDunningForPaymentFailure } from '../../domain/payments/dunning.service';
import { paymentAuditActions } from '../../domain/payments/payment.audit';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const webhookSecret = 'whsec_dunning_test_secret';

const benefits: MembershipBenefits = {
  maxActiveListings: 5,
  maxPhotosPerListing: 10,
  canUseFeaturedListings: true,
  includedFeaturedListings: 1,
  canAccessAuctions: false,
  canAccessMetrics: true,
  supportLevel: 'priority',
};

function signature(payload: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function stripeEvent(type: string, object: Record<string, unknown>) {
  return {
    id: `evt_${type.replace(/\W/g, '_')}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    data: { object },
  };
}

function postStripeEvent(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return request(app)
    .post('/payments/stripe/webhook')
    .set('Stripe-Signature', signature(payload))
    .set('Content-Type', 'application/json')
    .send(payload);
}

async function authToken(role: 'user' | 'admin' | 'super' = 'user') {
  const user = await createTestUser(role);
  return { token: signAccessToken({ sub: String(user._id), role, typ: 'access' }), user };
}

async function createPlan() {
  const suffix = Math.random().toString(36).slice(2, 8);
  return MembershipPlan.create({
    name: `Dunning Plan ${suffix}`,
    code: `dunning-${suffix}`,
    price: 299,
    currency: 'MXN',
    billingPeriod: 'monthly',
    stripePriceId: `price_test_${suffix}`,
    benefits,
    isActive: true,
    isPublic: true,
    sortOrder: 20,
  });
}

async function createStripeMembershipContext() {
  const user = await createTestUser('user');
  const plan = await createPlan();
  const now = new Date();
  const membership = await UserMembership.create({
    userId: user._id,
    planId: plan._id,
    status: 'active',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
    renewalMode: 'automatic',
    source: 'stripe',
    paymentProvider: 'stripe',
    providerCustomerId: 'cus_dunning',
    providerSubscriptionId: 'sub_dunning',
  });
  await PaymentCustomer.create({
    userId: user._id,
    provider: 'stripe',
    providerEnvironment: 'sandbox',
    providerCustomerId: 'cus_dunning',
    email: user.email,
    status: 'active',
  });
  await PaymentCheckoutSession.create({
    userId: user._id,
    membershipPlanId: plan._id,
    provider: 'stripe',
    providerEnvironment: 'sandbox',
    providerSessionId: 'cs_dunning',
    providerCustomerId: 'cus_dunning',
    checkoutRequestId: `checkout_${Math.random().toString(36).slice(2, 8)}`,
    mode: 'subscription',
    status: 'completed',
    amount: plan.price,
    currency: 'MXN',
  });

  return { user, plan, membership };
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `in_${Math.random().toString(36).slice(2, 8)}`,
    customer: 'cus_dunning',
    subscription: 'sub_dunning',
    payment_intent: `pi_${Math.random().toString(36).slice(2, 8)}`,
    amount_due: 29900,
    amount_paid: 29900,
    status_transitions: { paid_at: now },
    lines: {
      data: [{
        period: {
          start: now,
          end: now + 30 * 24 * 60 * 60,
        },
      }],
    },
    ...overrides,
  };
}

describe('membership dunning foundation', () => {
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_ENVIRONMENT = 'sandbox';
  });

  it('creates DunningState idempotently with grace and retry schedule', async () => {
    const { user, membership } = await createStripeMembershipContext();
    const failedAt = new Date('2026-01-01T00:00:00.000Z');
    const paymentRecord = await PaymentRecord.create({
      userId: user._id,
      membershipPlanId: membership.planId,
      userMembershipId: membership._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerInvoiceId: 'in_dunning_idempotent',
      type: 'membership',
      status: 'failed',
      amount: 299,
      currency: 'MXN',
      failedAt,
    });

    const first = await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      paymentRecordId: paymentRecord._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });
    const second = await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      paymentRecordId: paymentRecord._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });

    expect(String(second._id)).toBe(String(first._id));
    expect(await DunningState.countDocuments({ userMembershipId: membership._id, status: 'active' })).toBe(1);
    expect(first.retrySchedule.map((item) => item.day)).toEqual([0, 3, 7]);
    expect(first.graceEndsAt?.toISOString()).toBe('2026-01-04T00:00:00.000Z');
    expect(first.nextActionAt?.toISOString()).toBe('2026-01-04T00:00:00.000Z');

    const updatedMembership = await UserMembership.findById(membership._id).lean();
    expect(updatedMembership?.status).toBe('grace_period');
  });

  it('invoice.payment_failed moves membership to grace_period and creates notices', async () => {
    const { user, membership } = await createStripeMembershipContext();

    await postStripeEvent(stripeEvent('invoice.payment_failed', invoiceObject({
      id: 'in_payment_failed_dunning',
      payment_intent: 'pi_payment_failed_dunning',
    }))).expect(200);

    const updatedMembership = await UserMembership.findById(membership._id).lean();
    const dunning = await DunningState.findOne({ userMembershipId: membership._id }).lean();
    const failedRecord = await PaymentRecord.findOne({ providerInvoiceId: 'in_payment_failed_dunning' }).lean();

    expect(updatedMembership?.status).toBe('grace_period');
    expect(updatedMembership?.graceEndsAt).toBeInstanceOf(Date);
    expect(dunning?.status).toBe('active');
    expect(dunning?.retrySchedule.map((item) => item.day)).toEqual([0, 3, 7]);
    expect(failedRecord?.status).toBe('failed');
    expect(await Notification.exists({ userId: user._id, type: 'membership_payment_failed' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_grace_period_started' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.paymentFailedNotice })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.gracePeriodStartedNotice })).toBeTruthy();
    expect(await UserMembership.exists({ _id: membership._id, status: 'suspended' })).toBeFalsy();
  });

  it('invoice.paid recovers active dunning and keeps membership active', async () => {
    const { user, membership } = await createStripeMembershipContext();
    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt: new Date(Date.now() - 60_000),
      failureReason: 'invoice_payment_failed',
    });

    await postStripeEvent(stripeEvent('invoice.paid', invoiceObject({
      id: 'in_paid_recovered',
      payment_intent: 'pi_paid_recovered',
    }))).expect(200);

    const updatedMembership = await UserMembership.findById(membership._id).lean();
    const dunning = await DunningState.findOne({ userMembershipId: membership._id }).lean();

    expect(updatedMembership?.status).toBe('active');
    expect(updatedMembership?.graceEndsAt).toBeUndefined();
    expect(dunning?.status).toBe('recovered');
    expect(dunning?.recoveredAt).toBeInstanceOf(Date);
    expect(await Notification.exists({ userId: user._id, type: 'membership_recovered' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.dunningRecovered })).toBeTruthy();
  });

  it('processDunningDue moves expired grace_period to in_dunning', async () => {
    const { user, membership } = await createStripeMembershipContext();
    const failedAt = new Date(Date.now() - 4 * 24 * 60 * 60_000);
    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });

    const result = await processDunningDue(new Date());
    const updatedMembership = await UserMembership.findById(membership._id).lean();
    const dunning = await DunningState.findOne({ userMembershipId: membership._id }).lean();

    expect(result.movedToDunning).toBe(1);
    expect(updatedMembership?.status).toBe('in_dunning');
    expect(dunning?.status).toBe('active');
    expect(dunning?.nextActionAt).toBeInstanceOf(Date);
    expect(await Notification.exists({ userId: user._id, type: 'membership_dunning_started' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_dunning_retry' })).toBeTruthy();
  });

  it('processDunningDue suspends day 7 overdue memberships without changing listings', async () => {
    const { user, membership } = await createStripeMembershipContext();
    const failedAt = new Date(Date.now() - 8 * 24 * 60 * 60_000);
    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });

    const result = await processDunningDue(new Date());
    const updatedMembership = await UserMembership.findById(membership._id).lean();
    const dunning = await DunningState.findOne({ userMembershipId: membership._id }).lean();

    expect(result.suspended).toBe(1);
    expect(updatedMembership?.status).toBe('suspended');
    expect(updatedMembership?.suspendedAt).toBeInstanceOf(Date);
    expect(dunning?.status).toBe('suspended');
    expect(dunning?.suspendedAt).toBeInstanceOf(Date);
    expect(await Notification.exists({ userId: user._id, type: 'membership_suspended' })).toBeTruthy();
  });

  it('admin can list, inspect, and process due dunning states', async () => {
    const { user, membership } = await createStripeMembershipContext();
    const { token: userToken } = await authToken('user');
    const { token: adminToken } = await authToken('admin');
    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt: new Date(Date.now() - 4 * 24 * 60 * 60_000),
      failureReason: 'invoice_payment_failed',
    });
    const dunning = await DunningState.findOne({ userMembershipId: membership._id }).lean();

    await request(app).get('/admin/payments/dunning').expect(401);
    await request(app)
      .get('/admin/payments/dunning')
      .set('Authorization', bearer(userToken))
      .expect(403);

    const list = await request(app)
      .get('/admin/payments/dunning')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(list.body.items).toHaveLength(1);

    await request(app)
      .get(`/admin/payments/dunning/${dunning?._id}`)
      .set('Authorization', bearer(adminToken))
      .expect(200);

    const processed = await request(app)
      .post('/admin/payments/dunning/process-due')
      .set('Authorization', bearer(adminToken))
      .expect(200);
    expect(processed.body.movedToDunning).toBe(1);
  });

  it('notices are deduped and avoid prohibited language', async () => {
    const { user, membership } = await createStripeMembershipContext();
    const failedAt = new Date('2026-01-01T00:00:00.000Z');

    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });
    await startDunningForPaymentFailure({
      userId: user._id,
      userMembershipId: membership._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });

    const notices = await Notification.find({ userId: user._id }).lean();
    expect(await Notification.countDocuments({ userId: user._id, type: 'membership_payment_failed' })).toBe(1);
    expect(JSON.stringify(notices).toLowerCase()).not.toContain('inteligencia artificial');
    expect(JSON.stringify(notices).toLowerCase()).not.toContain('automatizacion interna');
  });
});
