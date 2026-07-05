import crypto from 'crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefit } from '../../domain/memberships/membershipBenefit.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { MembershipPaymentSession } from '../../domain/payments/membershipPaymentSession.model';
import { MembershipPaymentTransaction } from '../../domain/payments/membershipPaymentTransaction.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { requestMembershipPurchaseCheckout } from '../../domain/payments/membershipPurchase.service';
import { StripeCheckoutClient } from '../../domain/payments/stripePayment.service';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const webhookSecret = 'whsec_membership_purchase_test';
const stripeConfig = {
  enabled: true,
  environment: 'sandbox' as const,
  secretKey: 'sk_test_membership_purchase',
  webhookSecret,
  successUrl: 'https://frontend.test/membership/success',
  cancelUrl: 'https://frontend.test/membership/cancel',
};

function tokenFor(user: any, role: 'user' | 'admin' | 'super' = 'user') {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

function fakeStripeClient(sessionId = 'cs_test_membership_purchase'): StripeCheckoutClient {
  return {
    async createCustomer() {
      return { id: `cus_${sessionId}` };
    },
    async createCheckoutSession() {
      return {
        id: sessionId,
        url: `https://checkout.stripe.test/${sessionId}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };
    },
  };
}

async function createProfessionalPlan(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return MembershipPlan.create({
    code: `professional-${suffix}`,
    name: 'Professional',
    description: 'Professional purchase plan',
    monthlyPrice: 1500,
    yearlyPrice: 15000,
    durationDays: 30,
    price: 1500,
    currency: 'MXN',
    billingPeriod: 'manual',
    stripePriceId: `price_test_${suffix}`,
    benefits: {
      maxActiveListings: 25,
      maxPhotosPerListing: 20,
      canUseFeaturedListings: true,
      includedFeaturedListings: 5,
      canAccessAuctions: true,
      canAccessMetrics: false,
      supportLevel: 'priority',
    },
    limits: { animalListings: 25, auctionListings: 10, mediaUploads: 100, messaging: 500, featuredPublications: 5 },
    isActive: true,
    isPublic: true,
    sortOrder: 5,
    ...overrides,
  });
}

function signedEvent(event: any) {
  const raw = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = crypto.createHmac('sha256', webhookSecret).update(String(timestamp) + '.' + raw).digest('hex');
  return { raw, signature: 't=' + timestamp + ',v1=' + signature };
}

async function createCheckoutFor(user: any, plan: any, sessionId = 'cs_test_membership_purchase') {
  const result = await requestMembershipPurchaseCheckout(
    { userId: String(user._id), planId: String(plan._id) },
    stripeConfig,
    fakeStripeClient(sessionId)
  );
  expect(result.status).toBe(201);
  return result.body;
}

async function postStripeEvent(event: any, expectedStatus = 200) {
  const { raw, signature } = signedEvent(event);
  return request(app)
    .post('/payments/webhook/stripe')
    .set('Content-Type', 'application/json')
    .set('stripe-signature', signature)
    .send(raw)
    .expect(expectedStatus);
}

describe('membership purchase 13.2B', () => {
  it('creates checkout for a valid Professional plan without activating membership immediately', async () => {
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();

    const result = await requestMembershipPurchaseCheckout(
      { userId: String(user._id), planCode: plan.code },
      stripeConfig,
      fakeStripeClient('cs_checkout_valid')
    );

    expect(result.status).toBe(201);
    expect(result.body.checkoutUrl).toBe('https://checkout.stripe.test/cs_checkout_valid');

    const session = await MembershipPaymentSession.findById(result.body.paymentSessionId).lean();
    const membership = await UserMembership.findById(result.body.membershipId).lean();

    expect(session?.status).toBe('checkout_created');
    expect(session?.stripeCheckoutSessionId).toBe('cs_checkout_valid');
    expect(membership?.status).toBe('pending_activation');
    expect(await Audit.exists({ actor: String(user._id), action: 'PAYMENT_CHECKOUT_CREATED' })).toBeTruthy();
  });

  it('rejects checkout with missing plan, missing user, and active paid membership', async () => {
    const user = await createTestUser('user');
    const paidPlan = await createProfessionalPlan();

    const missingPlan = await requestMembershipPurchaseCheckout({ userId: String(user._id), planCode: 'missing' }, stripeConfig, fakeStripeClient());
    expect(missingPlan.status).toBe(404);

    const missingUser = await requestMembershipPurchaseCheckout({ userId: '64f000000000000000000001', planId: String(paidPlan._id) }, stripeConfig, fakeStripeClient());
    expect(missingUser.status).toBe(404);

    const now = new Date();
    await UserMembership.create({
      userId: user._id,
      planId: paidPlan._id,
      status: 'active',
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      renewalMode: 'manual',
      source: 'admin',
      paymentProvider: 'none',
    });

    const active = await requestMembershipPurchaseCheckout({ userId: String(user._id), planId: String(paidPlan._id) }, stripeConfig, fakeStripeClient());
    expect(active.status).toBe(409);
    expect(active.body.error).toBe('active_membership_exists');
  });

  it('keeps endpoint-level auth and rejects route checkout when Stripe is not configured', async () => {
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();

    await request(app).post('/membership/checkout').send({ planId: String(plan._id) }).expect(401);

    const res = await request(app)
      .post('/membership/checkout')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ planId: String(plan._id) })
      .expect(409);

    expect(res.body.error).toBe('stripe_not_configured');
  });

  it('processes a valid signed webhook once, records transaction, emits PaymentConfirmed, activates membership and grants benefits', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();
    const checkout = await createCheckoutFor(user, plan, 'cs_paid_once');

    const event = {
      id: 'evt_paid_once',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_paid_once',
          payment_status: 'paid',
          payment_intent: 'pi_paid_once',
          amount_total: 150000,
        },
      },
    };

    const res = await postStripeEvent(event);
    expect(res.body).toMatchObject({ ok: true, eventId: 'evt_paid_once', processed: true });

    const session = await MembershipPaymentSession.findById(checkout.paymentSessionId).lean();
    const transaction = await MembershipPaymentTransaction.findOne({ stripeEventId: 'evt_paid_once' }).lean();
    const membership = await UserMembership.findById(checkout.membershipId).lean();

    expect(session?.status).toBe('payment_confirmed');
    expect(transaction?.status).toBe('payment_confirmed');
    expect(transaction?.amount).toBe(1500);
    expect(membership?.status).toBe('active');
    expect(await MembershipBenefit.countDocuments({ membershipId: checkout.membershipId })).toBe(5);
    expect(await PaymentRecord.exists({ providerPaymentId: 'pi_paid_once', status: 'succeeded' })).toBeTruthy();
    expect(await PaymentWebhookLog.exists({ providerEventId: 'evt_paid_once', processed: true })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'payment_confirmed' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_activated_from_payment' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'PAYMENT_CONFIRMED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'MEMBERSHIP_ACTIVATED_FROM_PAYMENT' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'MEMBERSHIP_BENEFITS_GRANTED_FROM_PAYMENT' })).toBeTruthy();
  });

  it('ignores duplicate webhook without duplicate transaction or duplicate activation', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();
    const checkout = await createCheckoutFor(user, plan, 'cs_duplicate');
    const event = {
      id: 'evt_duplicate',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_duplicate', payment_intent: 'pi_duplicate', amount_total: 150000 } },
    };

    await postStripeEvent(event);
    const second = await postStripeEvent(event);

    expect(second.body.duplicate).toBe(true);
    expect(await MembershipPaymentTransaction.countDocuments({ stripeEventId: 'evt_duplicate' })).toBe(1);
    expect(await MembershipBenefit.countDocuments({ membershipId: checkout.membershipId })).toBe(5);
    expect(await Audit.exists({ action: 'PAYMENT_WEBHOOK_DUPLICATE_IGNORED' })).toBeTruthy();
  });

  it('rejects invalid webhook payload and invalid signature', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const invalid = JSON.stringify({ id: 'evt_invalid', type: 'checkout.session.completed' });
    const timestamp = Math.floor(Date.now() / 1000);

    await request(app)
      .post('/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', `t=${timestamp},v1=bad`)
      .send(invalid)
      .expect(400);

    const { raw, signature } = signedEvent({ id: 'evt_invalid_payload', type: 'checkout.session.completed', data: {} });
    await request(app)
      .post('/payments/webhook/stripe')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', signature)
      .send(raw)
      .expect(400);

    expect(await Audit.exists({ action: 'PAYMENT_WEBHOOK_INVALID' })).toBeTruthy();
  });

  it('records checkout expiration and failed payment without activating membership', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();
    const expiredCheckout = await createCheckoutFor(user, plan, 'cs_expired_purchase');

    await postStripeEvent({
      id: 'evt_expired_purchase',
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_expired_purchase' } },
    });

    expect((await MembershipPaymentSession.findById(expiredCheckout.paymentSessionId).lean())?.status).toBe('checkout_expired');
    expect((await UserMembership.findById(expiredCheckout.membershipId).lean())?.status).toBe('pending_activation');

    const failedCheckout = await createCheckoutFor(await createTestUser('user'), plan, 'cs_failed_purchase');
    await postStripeEvent({
      id: 'evt_failed_purchase',
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: 'cs_failed_purchase', payment_intent: 'pi_failed_purchase', amount_total: 150000 } },
    });

    expect((await MembershipPaymentSession.findById(failedCheckout.paymentSessionId).lean())?.status).toBe('payment_failed');
    expect(await MembershipPaymentTransaction.exists({ stripeEventId: 'evt_failed_purchase', status: 'payment_failed' })).toBeTruthy();
    expect(await Notification.exists({ type: 'payment_failed' })).toBeTruthy();
    expect(await Audit.exists({ action: 'PAYMENT_FAILED' })).toBeTruthy();
    expect(await Audit.exists({ action: 'PAYMENT_CANCELLED' })).toBeTruthy();
  });

  it('allows user and admin to read payment records safely', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const user = await createTestUser('user');
    const admin = await createTestUser('admin');
    const plan = await createProfessionalPlan();
    await createCheckoutFor(user, plan, 'cs_read_payment');
    await postStripeEvent({
      id: 'evt_read_payment',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_read_payment', payment_intent: 'pi_read_payment', amount_total: 150000 } },
    });
    const transaction = await MembershipPaymentTransaction.findOne({ stripeEventId: 'evt_read_payment' }).lean();

    await request(app)
      .get(`/payments/${transaction?._id}`)
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);

    const list = await request(app)
      .get('/admin/payments')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    await request(app)
      .get(`/admin/payments/${transaction?._id}`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    expect(list.body.items.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(list.body)).not.toContain('sk_test');
    expect(JSON.stringify(list.body)).not.toContain('whsec_');
  });

  it('keeps Membership Foundation compatible and exposes current membership benefits after purchase', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();
    const checkout = await createCheckoutFor(user, plan, 'cs_current_membership');
    await postStripeEvent({
      id: 'evt_current_membership',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_current_membership', payment_intent: 'pi_current_membership', amount_total: 150000 } },
    });

    const current = await request(app)
      .get('/memberships/current')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);
    const benefits = await request(app)
      .get('/memberships/current/benefits')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);

    expect(current.body.membership.status).toBe('active');
    expect(String(current.body.membership._id)).toBe(checkout.membershipId);
    expect(benefits.body.benefits).toHaveLength(5);
  });

  it('exposes membershipPurchases metrics and leaves excluded domains untouched', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    const admin = await createTestUser('admin');
    const user = await createTestUser('user');
    const plan = await createProfessionalPlan();
    await createCheckoutFor(user, plan, 'cs_acc_purchase');
    await postStripeEvent({
      id: 'evt_acc_purchase',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_acc_purchase', payment_intent: 'pi_acc_purchase', amount_total: 150000 } },
    });

    const res = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    expect(res.body.membershipPurchases.checkoutSessionsCreated).toBeGreaterThanOrEqual(1);
    expect(res.body.membershipPurchases.paymentsConfirmed).toBeGreaterThanOrEqual(1);
    expect(res.body.membershipPurchases.membershipsActivatedFromPayment).toBeGreaterThanOrEqual(1);
    expect(res.body.fiscal).toBeDefined();
    expect(res.body.aoe).toBeDefined();
    expect(res.body.knowledgeFoundation).toBeDefined();
  });
});






