import { createHmac } from 'crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { ensureFreeMembershipForUser } from '../../domain/memberships/membership.service';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { paymentAuditActions } from '../../domain/payments/payment.audit';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { createTestUser } from '../../test/helpers/factories';

const webhookSecret = 'whsec_test_secret';

const benefits: MembershipBenefits = {
  maxActiveListings: 10,
  maxPhotosPerListing: 10,
  canUseFeaturedListings: true,
  includedFeaturedListings: 2,
  canAccessAuctions: false,
  canAccessMetrics: true,
  supportLevel: 'priority',
};

beforeEach(() => {
  process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  process.env.STRIPE_ENVIRONMENT = 'sandbox';
});

function stripeSignature(payload: string, secret = webhookSecret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

function stripeEvent(type: string, object: Record<string, unknown>, id = `evt_${Math.random().toString(36).slice(2)}`) {
  return {
    id,
    type,
    data: { object },
  };
}

function postStripeEvent(event: Record<string, unknown>, signature?: string) {
  const payload = JSON.stringify(event);
  return request(app)
    .post('/payments/stripe/webhook')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', signature ?? stripeSignature(payload))
    .send(payload);
}

async function createPaidPlan(code = `pro-${Math.random().toString(36).slice(2, 8)}`) {
  return MembershipPlan.create({
    name: `Paid ${code}`,
    code,
    price: 499,
    currency: 'MXN',
    billingPeriod: 'monthly',
    benefits,
    isActive: true,
    isPublic: true,
    sortOrder: 20,
  });
}

async function createCorrelatedPaymentContext() {
  const user = await createTestUser();
  const plan = await createPaidPlan();
  const customerId = `cus_${Math.random().toString(36).slice(2, 10)}`;
  const subscriptionId = `sub_${Math.random().toString(36).slice(2, 10)}`;
  const sessionId = `cs_${Math.random().toString(36).slice(2, 10)}`;

  await PaymentCustomer.create({
    userId: user._id,
    provider: 'stripe',
    providerEnvironment: 'sandbox',
    providerCustomerId: customerId,
    email: user.email,
    status: 'active',
  });
  await PaymentCheckoutSession.create({
    userId: user._id,
    membershipPlanId: plan._id,
    provider: 'stripe',
    providerSessionId: sessionId,
    providerCustomerId: customerId,
    checkoutRequestId: `checkout_${Math.random().toString(36).slice(2, 10)}`,
    mode: 'subscription',
    status: 'completed',
    amount: plan.price,
    currency: 'MXN',
    metadata: {
      membershipPlanCode: plan.code,
      userId: String(user._id),
    },
  });

  return { user, plan, customerId, subscriptionId, sessionId };
}

function invoiceObject(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: `in_${Math.random().toString(36).slice(2, 10)}`,
    customer: 'cus_test',
    subscription: 'sub_test',
    payment_intent: `pi_${Math.random().toString(36).slice(2, 10)}`,
    amount_paid: 49900,
    amount_due: 49900,
    currency: 'mxn',
    status_transitions: { paid_at: now },
    lines: {
      data: [
        {
          period: {
            start: now,
            end: now + 30 * 24 * 60 * 60,
          },
        },
      ],
    },
    ...overrides,
  };
}

describe('Stripe webhook foundation', () => {
  it('rejects webhook without signature', async () => {
    const event = stripeEvent('checkout.session.completed', { id: 'cs_missing_sig' });

    const res = await request(app)
      .post('/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(event))
      .expect(400);

    expect(res.body.error).toBe('stripe_signature_missing');
  });

  it('rejects invalid signature', async () => {
    const event = stripeEvent('checkout.session.completed', { id: 'cs_bad_sig' });

    const res = await postStripeEvent(event, 't=123,v1=bad').expect(400);

    expect(res.body.error).toBe('stripe_signature_invalid');
  });

  it('accepts valid signature with raw body verification', async () => {
    const user = await createTestUser();
    const plan = await createPaidPlan();
    const checkoutRequestId = 'checkout_valid_signature';
    await PaymentCheckoutSession.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      checkoutRequestId,
      mode: 'subscription',
      status: 'open',
      amount: plan.price,
      currency: 'MXN',
    });

    const event = stripeEvent('checkout.session.completed', {
      id: 'cs_valid_signature',
      customer: 'cus_valid_signature',
      metadata: { checkoutRequestId },
    });

    const res = await postStripeEvent(event).expect(200);

    expect(res.body.ok).toBe(true);
    expect(await PaymentWebhookLog.exists({ providerEventId: event.id, processed: true })).toBeTruthy();
  });

  it('processed duplicate event returns ok without reprocessing', async () => {
    const { customerId, subscriptionId } = await createCorrelatedPaymentContext();
    const event = stripeEvent('invoice.paid', invoiceObject({ customer: customerId, subscription: subscriptionId }), 'evt_duplicate_paid');

    await postStripeEvent(event).expect(200);
    await postStripeEvent(event).expect(200);

    expect(await PaymentRecord.countDocuments({ providerInvoiceId: (event.data.object as any).id })).toBe(1);
    expect((await PaymentWebhookLog.findOne({ providerEventId: event.id }))?.attempts).toBe(1);
  });

  it('failed event can be retried and attempts increment with lastError', async () => {
    const event = stripeEvent('invoice.paid', invoiceObject({ customer: 'cus_missing' }), 'evt_retry_failed');

    await postStripeEvent(event).expect(200);
    await postStripeEvent(event).expect(200);

    const log = await PaymentWebhookLog.findOne({ providerEventId: event.id });
    expect(log?.processed).toBe(false);
    expect(log?.attempts).toBe(2);
    expect(log?.lastError).toBe('payment_customer_not_found');
    expect(await Audit.exists({ action: paymentAuditActions.webhookFailed })).toBeTruthy();
  });

  it('invoice.paid without internal correlation does not activate membership', async () => {
    const user = await createTestUser();
    await ensureFreeMembershipForUser(user._id);
    const event = stripeEvent('invoice.paid', invoiceObject({ customer: 'cus_no_correlation' }));

    const res = await postStripeEvent(event).expect(200);

    expect(res.body.ok).toBe(false);
    expect(await UserMembership.countDocuments({ userId: user._id, paymentProvider: 'stripe' })).toBe(0);
  });

  it('checkout.session.completed updates local checkout session but does not activate paid membership', async () => {
    const user = await createTestUser();
    const plan = await createPaidPlan();
    const checkoutRequestId = 'checkout_completed_no_activation';
    await ensureFreeMembershipForUser(user._id);
    await PaymentCheckoutSession.create({
      userId: user._id,
      membershipPlanId: plan._id,
      provider: 'stripe',
      checkoutRequestId,
      mode: 'subscription',
      status: 'open',
      amount: plan.price,
      currency: 'MXN',
    });

    await postStripeEvent(stripeEvent('checkout.session.completed', {
      id: 'cs_completed_no_activation',
      customer: 'cus_checkout_completed',
      metadata: { checkoutRequestId },
    })).expect(200);

    const session = await PaymentCheckoutSession.findOne({ checkoutRequestId });
    expect(session?.status).toBe('completed');
    expect(session?.providerSessionId).toBe('cs_completed_no_activation');
    expect(await UserMembership.countDocuments({ userId: user._id, paymentProvider: 'stripe' })).toBe(0);
  });

  it('invoice.paid creates succeeded payment record and activates paid membership', async () => {
    const { user, plan, customerId, subscriptionId } = await createCorrelatedPaymentContext();
    await ensureFreeMembershipForUser(user._id);

    const event = stripeEvent('invoice.paid', invoiceObject({
      customer: customerId,
      subscription: subscriptionId,
      id: 'in_paid_activation',
      payment_intent: 'pi_paid_activation',
    }));

    const res = await postStripeEvent(event).expect(200);

    expect(res.body.ok).toBe(true);
    const paidMembership = await UserMembership.findOne({
      userId: user._id,
      paymentProvider: 'stripe',
      providerSubscriptionId: subscriptionId,
      status: 'active',
    });
    expect(String(paidMembership?.planId)).toBe(String(plan._id));
    expect(await UserMembership.countDocuments({
      userId: user._id,
      status: { $in: ['active', 'grace_period', 'in_dunning'] },
    })).toBe(1);
    const record = await PaymentRecord.findOne({ providerInvoiceId: 'in_paid_activation' });
    expect(record?.status).toBe('succeeded');
    expect(record?.providerPaymentId).toBe('pi_paid_activation');
    expect(record?.amount).toBe(499);
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.paymentSucceeded })).toBeTruthy();
  });

  it('invoice.payment_failed creates failed record and starts paid membership dunning', async () => {
    const { user, customerId, subscriptionId } = await createCorrelatedPaymentContext();
    const plan = await createPaidPlan('existing-paid-failed');
    const now = new Date();
    await UserMembership.create({
      userId: user._id,
      planId: plan._id,
      status: 'active',
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      renewalMode: 'automatic',
      source: 'stripe',
      paymentProvider: 'stripe',
      providerCustomerId: customerId,
      providerSubscriptionId: subscriptionId,
    });

    await postStripeEvent(stripeEvent('invoice.payment_failed', invoiceObject({
      customer: customerId,
      subscription: subscriptionId,
      id: 'in_failed_payment',
      payment_intent: 'pi_failed_payment',
    }))).expect(200);

    const membership = await UserMembership.findOne({ providerSubscriptionId: subscriptionId });
    const record = await PaymentRecord.findOne({ providerInvoiceId: 'in_failed_payment' });
    const dunning = await DunningState.findOne({ userMembershipId: membership?._id });
    expect(membership?.status).toBe('grace_period');
    expect(membership?.graceEndsAt).toBeInstanceOf(Date);
    expect(dunning?.status).toBe('active');
    expect(record?.status).toBe('failed');
    expect(record?.failureReason).toBe('invoice_payment_failed');
    expect(await Notification.exists({ userId: user._id, type: 'membership_payment_failed' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.paymentFailed })).toBeTruthy();
  });

  it('customer.subscription.updated records lifecycle without activating membership', async () => {
    const { user, customerId, subscriptionId } = await createCorrelatedPaymentContext();

    await postStripeEvent(stripeEvent('customer.subscription.updated', {
      id: subscriptionId,
      customer: customerId,
      current_period_end: Math.floor(Date.now() / 1000) + 3600,
    })).expect(200);

    expect(await UserMembership.countDocuments({ userId: user._id, paymentProvider: 'stripe' })).toBe(0);
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.subscriptionUpdated })).toBeTruthy();
  });

  it('customer.subscription.deleted cancels paid membership and guarantees active Free', async () => {
    const { user, plan, customerId, subscriptionId } = await createCorrelatedPaymentContext();
    const now = new Date();
    await UserMembership.create({
      userId: user._id,
      planId: plan._id,
      status: 'active',
      startsAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60_000),
      renewalMode: 'automatic',
      source: 'stripe',
      paymentProvider: 'stripe',
      providerCustomerId: customerId,
      providerSubscriptionId: subscriptionId,
    });

    await postStripeEvent(stripeEvent('customer.subscription.deleted', {
      id: subscriptionId,
      customer: customerId,
    })).expect(200);

    const paid = await UserMembership.findOne({ providerSubscriptionId: subscriptionId });
    const active = await UserMembership.findOne({ userId: user._id, status: 'active' }).populate('planId');
    expect(paid?.status).toBe('cancelled');
    expect((active?.planId as any).code).toBe('free');
    expect(await UserMembership.countDocuments({ userId: user._id, status: 'active' })).toBe(1);
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.revertedToFree })).toBeTruthy();
  });

  it('does not store full payload or card data in webhook log', async () => {
    const event = stripeEvent('checkout.session.completed', {
      id: 'cs_sensitive_payload',
      card: { number: '4242424242424242', cvc: '123' },
    });

    await postStripeEvent(event).expect(200);

    const log = await PaymentWebhookLog.findOne({ providerEventId: event.id }).lean();
    expect(log?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(log)).not.toContain('4242424242424242');
    expect(JSON.stringify(log)).not.toContain('123');
  });
});
