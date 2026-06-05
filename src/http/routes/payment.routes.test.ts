import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { paymentAuditActions } from '../../domain/payments/payment.audit';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import {
  getStripeConfig,
  toSafeStripeConfig,
  validateStripeConfig,
} from '../../domain/payments/stripe.config';
import { requestMembershipCheckout } from '../../domain/payments/stripePayment.service';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const benefits: MembershipBenefits = {
  maxActiveListings: 5,
  maxPhotosPerListing: 10,
  canUseFeaturedListings: true,
  includedFeaturedListings: 1,
  canAccessAuctions: false,
  canAccessMetrics: true,
  supportLevel: 'priority',
};

async function authToken(role: 'user' | 'admin' | 'super' = 'user') {
  const user = await createTestUser(role);
  return { token: signAccessToken({ sub: String(user._id), role, typ: 'access' }), user };
}

async function createPlan(overrides: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);

  return MembershipPlan.create({
    name: `Payment Plan ${suffix}`,
    code: `pay-${suffix}`,
    price: 299,
    currency: 'MXN',
    billingPeriod: 'monthly',
    benefits,
    isActive: true,
    isPublic: true,
    sortOrder: 10,
    ...overrides,
  });
}

describe('Stripe payment foundation', () => {
  it('keeps Stripe disabled by default with sandbox environment', () => {
    const config = getStripeConfig({});

    expect(config.enabled).toBe(false);
    expect(config.environment).toBe('sandbox');
  });

  it('does not expose Stripe secrets in safe config', () => {
    const safe = toSafeStripeConfig(getStripeConfig({
      STRIPE_ENABLED: 'true',
      STRIPE_ENVIRONMENT: 'production',
      STRIPE_SECRET_KEY: 'sk_test_sensitive',
      STRIPE_WEBHOOK_SECRET: 'whsec_sensitive',
      STRIPE_SUCCESS_URL: 'https://example.test/success',
    }));

    expect(safe).toEqual({
      enabled: true,
      environment: 'production',
      hasSecretKey: true,
      hasWebhookSecret: true,
      hasSuccessUrl: true,
      hasCancelUrl: false,
    });
    expect(JSON.stringify(safe)).not.toContain('sk_test_sensitive');
    expect(JSON.stringify(safe)).not.toContain('whsec_sensitive');
  });

  it('blocks enabled Stripe config when secret key is missing', () => {
    const validation = validateStripeConfig(getStripeConfig({ STRIPE_ENABLED: 'true' }));

    expect(validation.ok).toBe(false);
    expect(validation.issues).toContain('stripe_secret_key_missing');
  });

  it('creates a valid PaymentCustomer', async () => {
    const user = await createTestUser();
    const customer = await PaymentCustomer.create({
      userId: user._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerCustomerId: 'cus_test_1',
      email: user.email,
      status: 'active',
    });

    expect(String(customer.userId)).toBe(String(user._id));
    expect(customer.provider).toBe('stripe');
    expect(customer.status).toBe('active');
  });

  it('enforces providerCustomerId uniqueness per provider and environment', async () => {
    await PaymentCustomer.init();
    const user = await createTestUser();
    const other = await createTestUser();

    await PaymentCustomer.create({
      userId: user._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerCustomerId: 'cus_unique',
      status: 'active',
    });

    await expect(PaymentCustomer.create({
      userId: other._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerCustomerId: 'cus_unique',
      status: 'active',
    })).rejects.toMatchObject({ code: 11000 });
  });

  it('creates a valid PaymentCheckoutSession and enforces checkoutRequestId uniqueness', async () => {
    await PaymentCheckoutSession.init();
    const user = await createTestUser();
    const plan = await createPlan();

    await PaymentCheckoutSession.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      checkoutRequestId: 'checkout_unique',
      mode: 'subscription',
      status: 'failed',
      amount: plan.price,
      currency: 'MXN',
    });

    await expect(PaymentCheckoutSession.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      checkoutRequestId: 'checkout_unique',
      mode: 'subscription',
      status: 'failed',
      amount: plan.price,
      currency: 'MXN',
    })).rejects.toMatchObject({ code: 11000 });
  });

  it('creates a valid PaymentRecord with environment and metadata', async () => {
    const user = await createTestUser();
    const plan = await createPlan();

    const record = await PaymentRecord.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      type: 'membership',
      status: 'pending',
      amount: plan.price,
      currency: 'MXN',
      metadata: { source: 'test' },
    });

    expect(record.providerEnvironment).toBe('sandbox');
    expect(record.metadata).toMatchObject({ source: 'test' });
  });

  it('enforces PaymentWebhookLog event id uniqueness without storing payloads', async () => {
    await PaymentWebhookLog.init();
    await PaymentWebhookLog.create({
      provider: 'stripe',
      providerEventId: 'evt_unique',
      eventType: 'checkout.session.completed',
      payloadHash: 'hash-only',
      processed: false,
    });

    await expect(PaymentWebhookLog.create({
      provider: 'stripe',
      providerEventId: 'evt_unique',
      eventType: 'checkout.session.completed',
      payloadHash: 'hash-only',
      processed: false,
    })).rejects.toMatchObject({ code: 11000 });
  });

  it('requires auth for membership checkout', async () => {
    await request(app)
      .post('/account/membership/checkout')
      .send({ planCode: 'pro' })
      .expect(401);
  });

  it('blocks checkout for Free plan', async () => {
    const { token } = await authToken('user');
    await createPlan({ code: 'free', price: 0 });

    const res = await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: 'free' })
      .expect(400);

    expect(res.body).toEqual({ ok: false, error: 'free_plan_checkout_not_allowed' });
  });

  it('blocks checkout for missing, inactive, or private plans', async () => {
    const { token } = await authToken('user');
    const inactive = await createPlan({ code: 'inactive-plan', isActive: false });
    const privatePlan = await createPlan({ code: 'private-plan', isPublic: false });

    await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: 'missing-plan' })
      .expect(404);

    await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: inactive.code })
      .expect(409);

    await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: privatePlan.code })
      .expect(409);
  });

  it('records checkout request audit and local failed checkout session when Stripe is disabled', async () => {
    const { token, user } = await authToken('user');
    const plan = await createPlan({ code: 'pro-checkout' });

    const res = await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: plan.code })
      .expect(200);

    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe('stripe_disabled');
    expect(res.body.checkoutRequestId).toMatch(/^checkout_/);

    const session = await PaymentCheckoutSession.findOne({ checkoutRequestId: res.body.checkoutRequestId });
    expect(session?.status).toBe('failed');
    expect(session?.amount).toBe(plan.price);
    expect(session?.providerSessionId).toBeUndefined();

    expect(await Audit.exists({
      actor: String(user._id),
      action: paymentAuditActions.membershipCheckoutRequested,
    })).toBeTruthy();
  });

  it('does not activate or change membership during checkout request', async () => {
    const { user } = await authToken('user');
    const plan = await createPlan({ code: 'direct-service-checkout' });

    const result = await requestMembershipCheckout({
      userId: String(user._id),
      planCode: plan.code,
    }, {
      enabled: false,
      environment: 'sandbox',
    });

    expect(result.body).toMatchObject({ ok: false, error: 'stripe_disabled' });
    expect(await UserMembership.countDocuments({ userId: user._id })).toBe(0);
  });

  it('does not call Stripe or create real provider ids when Stripe is disabled', async () => {
    const { token } = await authToken('user');
    const plan = await createPlan({ code: 'no-provider-call' });

    const res = await request(app)
      .post('/account/membership/checkout')
      .set('Authorization', bearer(token))
      .send({ planCode: plan.code })
      .expect(200);

    const session = await PaymentCheckoutSession.findOne({ checkoutRequestId: res.body.checkoutRequestId }).lean();

    expect(session?.providerSessionId).toBeUndefined();
    expect(session?.providerCustomerId).toBeUndefined();
  });

  it('admin payment endpoints require admin or super role', async () => {
    const { token: userToken } = await authToken('user');
    const { token: adminToken } = await authToken('admin');
    const { token: superToken } = await authToken('super');

    await request(app).get('/admin/payments/customers').expect(401);

    await request(app)
      .get('/admin/payments/customers')
      .set('Authorization', bearer(userToken))
      .expect(403);

    await request(app)
      .get('/admin/payments/customers')
      .set('Authorization', bearer(adminToken))
      .expect(200);

    await request(app)
      .get('/admin/payments/checkout-sessions')
      .set('Authorization', bearer(superToken))
      .expect(200);
  });

  it('admin payment endpoints return safe read-only lists', async () => {
    const { token, user } = await authToken('admin');
    const plan = await createPlan();
    await PaymentCheckoutSession.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      checkoutRequestId: 'checkout_admin_list',
      mode: 'subscription',
      status: 'failed',
      amount: plan.price,
      currency: 'MXN',
    });
    await PaymentRecord.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      type: 'membership',
      status: 'pending',
      amount: plan.price,
      currency: 'MXN',
    });
    await PaymentWebhookLog.create({
      provider: 'stripe',
      providerEventId: 'evt_admin_list',
      eventType: 'checkout.session.completed',
      payloadHash: 'hash-only',
      processed: false,
    });

    const sessions = await request(app)
      .get('/admin/payments/checkout-sessions')
      .set('Authorization', bearer(token))
      .expect(200);
    const records = await request(app)
      .get('/admin/payments/records')
      .set('Authorization', bearer(token))
      .expect(200);
    const logs = await request(app)
      .get('/admin/payments/webhook-logs')
      .set('Authorization', bearer(token))
      .expect(200);

    expect(sessions.body.items).toHaveLength(1);
    expect(records.body.items).toHaveLength(1);
    expect(logs.body.items).toHaveLength(1);
    expect(JSON.stringify(logs.body)).not.toContain('payload":');
    expect(JSON.stringify({ sessions: sessions.body, records: records.body, logs: logs.body })).not.toContain('sk_');
  });
});
