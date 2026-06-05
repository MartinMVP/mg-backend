import { createHmac } from 'crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { Listing } from '../../domain/listings/listing.model';
import { membershipAuditActions } from '../../domain/memberships/membership.audit';
import { canCreateListing as canCreateListingByPolicy } from '../../domain/memberships/membershipCatalogPolicy';
import { MembershipChangeLog } from '../../domain/memberships/membershipChangeLog.model';
import { processMembershipPendingChanges } from '../../domain/memberships/membershipChange.service';
import { MembershipBenefits, MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { ensureFreeMembershipForUser } from '../../domain/memberships/membership.service';
import { MembershipUsage } from '../../domain/memberships/membershipUsage.model';
import { UserMembership } from '../../domain/memberships/userMembership.model';
import { Notification } from '../../domain/notifications/notification.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { processDunningDue } from '../../domain/payments/dunning.service';
import { paymentAuditActions } from '../../domain/payments/payment.audit';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { requestMembershipCheckout, StripeCheckoutClient } from '../../domain/payments/stripePayment.service';
import { bearer } from '../../test/helpers/auth';
import { createTestListing, createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

const webhookSecret = 'whsec_revenue_flow_validation';

const benefits: MembershipBenefits = {
  maxActiveListings: 3,
  maxPhotosPerListing: 5,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

const sandboxConfig = {
  enabled: true,
  environment: 'sandbox' as const,
  secretKey: 'sk_test_revenue_validation',
  successUrl: 'https://frontend.test/success',
  cancelUrl: 'https://frontend.test/cancel',
};

function tokenFor(user: any, role = user.role) {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

function signature(payload: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

function stripeEvent(type: string, object: Record<string, unknown>, id = `evt_${type}_${Math.random().toString(36).slice(2, 8)}`) {
  return {
    id,
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

function invoiceObject(params: {
  customerId: string;
  subscriptionId: string;
  invoiceId?: string;
  paymentIntentId?: string;
  amount?: number;
  periodStart?: number;
  periodEnd?: number;
}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: params.invoiceId ?? `in_${Math.random().toString(36).slice(2, 8)}`,
    customer: params.customerId,
    subscription: params.subscriptionId,
    payment_intent: params.paymentIntentId ?? `pi_${Math.random().toString(36).slice(2, 8)}`,
    amount_due: params.amount ?? 49900,
    amount_paid: params.amount ?? 49900,
    currency: 'mxn',
    status_transitions: { paid_at: now },
    lines: {
      data: [{
        period: {
          start: params.periodStart ?? now,
          end: params.periodEnd ?? now + 30 * 24 * 60 * 60,
        },
      }],
    },
  };
}

function fakeStripeClient() {
  const client: StripeCheckoutClient = {
    async createCustomer(input) {
      return { id: `cus_${input.userId.slice(-8)}` };
    },
    async createCheckoutSession(input) {
      return {
        id: `cs_${input.checkoutRequestId.slice(-8)}`,
        url: `https://checkout.stripe.test/${input.checkoutRequestId}`,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };
    },
  };

  return client;
}

async function createPlan(code: string, price: number, maxActiveListings = 3) {
  return MembershipPlan.create({
    name: `Revenue ${code}`,
    code,
    price,
    currency: 'MXN',
    billingPeriod: price > 0 ? 'monthly' : 'manual',
    benefits: { ...benefits, maxActiveListings },
    isActive: true,
    isPublic: true,
    sortOrder: price,
    stripePriceId: price > 0 ? `price_${code}` : undefined,
  });
}

async function createPaidContext(plan: any, status = 'active', daysFromNow = 30) {
  const user = await createTestUser();
  const now = new Date();
  const customerId = `cus_${Math.random().toString(36).slice(2, 8)}`;
  const subscriptionId = `sub_${Math.random().toString(36).slice(2, 8)}`;
  const membership = await UserMembership.create({
    userId: user._id,
    planId: plan._id,
    status,
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: new Date(now.getTime() + daysFromNow * 24 * 60 * 60_000),
    renewalMode: 'automatic',
    source: 'stripe',
    paymentProvider: 'stripe',
    providerCustomerId: customerId,
    providerSubscriptionId: subscriptionId,
  });
  await MembershipUsage.create({
    userId: user._id,
    membershipId: membership._id,
    planId: plan._id,
    periodStart: membership.currentPeriodStart,
    periodEnd: membership.currentPeriodEnd,
  });
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
    providerEnvironment: 'sandbox',
    providerSessionId: `cs_${Math.random().toString(36).slice(2, 8)}`,
    providerCustomerId: customerId,
    checkoutRequestId: `checkout_${Math.random().toString(36).slice(2, 8)}`,
    mode: 'subscription',
    status: 'completed',
    amount: plan.price,
    currency: 'MXN',
  });

  return { user, membership, customerId, subscriptionId };
}

async function activePlanCode(userId: any) {
  const membership = await UserMembership.findOne({
    userId,
    status: { $in: ['active', 'grace_period', 'in_dunning'] },
  }).populate('planId');
  return (membership?.planId as any)?.code;
}

describe('Sprint 9.7 revenue flow validation', () => {
  it('validates Free to checkout, invoice.paid activation, reports and revenue audit trail', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_ENVIRONMENT = 'sandbox';

    const user = await createTestUser();
    const admin = await createTestUser('admin');
    const free = await createPlan('free', 0, 1);
    const pro = await createPlan('pro', 499, 3);
    await ensureFreeMembershipForUser(user._id);

    const checkout = await requestMembershipCheckout({
      userId: String(user._id),
      planCode: pro.code,
    }, sandboxConfig, fakeStripeClient());
    const session = await PaymentCheckoutSession.findOne({ userId: user._id, membershipPlanId: pro._id }).lean();
    const customer = await PaymentCustomer.findOne({ userId: user._id }).lean();

    expect(checkout.body.ok).toBe(true);
    expect(customer?.providerCustomerId).toMatch(/^cus_/);
    expect(session?.status).toBe('open');
    expect(session?.checkoutUrl).toContain('checkout.stripe.test');
    expect(await activePlanCode(user._id)).toBe(free.code);
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.membershipCheckoutRequested })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.membershipCheckoutCreated })).toBeTruthy();

    await postStripeEvent(stripeEvent('checkout.session.completed', {
      id: session?.providerSessionId,
      customer: customer?.providerCustomerId,
      metadata: { checkoutRequestId: session?.checkoutRequestId },
    }, 'evt_revenue_checkout_completed')).expect(200);

    await postStripeEvent(stripeEvent('invoice.paid', invoiceObject({
      customerId: customer!.providerCustomerId,
      subscriptionId: 'sub_revenue_pro',
      invoiceId: 'in_revenue_pro_paid',
      paymentIntentId: 'pi_revenue_pro_paid',
    }), 'evt_revenue_invoice_paid')).expect(200);

    expect(await activePlanCode(user._id)).toBe(pro.code);
    expect(await PaymentRecord.exists({ providerInvoiceId: 'in_revenue_pro_paid', status: 'succeeded' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: paymentAuditActions.paymentSucceeded })).toBeTruthy();

    const dashboard = await request(app)
      .get('/admin/membership/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    const subscriptions = await request(app)
      .get('/admin/membership/subscriptions?plan=pro&status=active')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    const payments = await request(app)
      .get('/admin/payments/records?status=succeeded&provider=stripe&membershipPlan=pro')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    const csv = await request(app)
      .get('/admin/membership/export')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    expect(dashboard.body.plans.pro).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.payments.succeeded).toBeGreaterThanOrEqual(1);
    expect(subscriptions.body.items.length).toBeGreaterThanOrEqual(1);
    expect(payments.body.items.length).toBeGreaterThanOrEqual(1);
    expect(csv.text).toContain('user,email,plan,status');
    expect(JSON.stringify({ dashboard: dashboard.body, payments: payments.body })).not.toContain('sk_');
  });

  it('validates upgrade only after invoice.paid', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_ENVIRONMENT = 'sandbox';

    const pro = await createPlan('pro', 499, 3);
    const business = await createPlan('business', 999, 10);
    const { user, membership, customerId } = await createPaidContext(pro);

    const upgrade = await request(app)
      .post('/account/membership/change-plan')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ targetPlanCode: business.code })
      .expect(409);
    expect(upgrade.body.requiresCheckout).toBe(true);
    expect(await activePlanCode(user._id)).toBe(pro.code);

    const checkout = await requestMembershipCheckout({
      userId: String(user._id),
      planCode: business.code,
    }, sandboxConfig, fakeStripeClient());
    const businessSession = await PaymentCheckoutSession.findOne({ checkoutRequestId: checkout.body.checkoutRequestId }).lean();
    expect(String((await UserMembership.findById(membership._id))?.pendingPlanId)).toBe(String(business._id));

    await postStripeEvent(stripeEvent('invoice.paid', invoiceObject({
      customerId,
      subscriptionId: 'sub_revenue_business',
      invoiceId: 'in_revenue_business_paid',
      paymentIntentId: 'pi_revenue_business_paid',
    }), 'evt_revenue_business_paid')).expect(200);

    expect(businessSession?.membershipPlanId).toEqual(business._id);
    expect(await activePlanCode(user._id)).toBe(business.code);
    expect(await MembershipChangeLog.exists({ userId: user._id, changeType: 'upgrade_requested' })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'membership_upgrade_requested' })).toBeTruthy();
  });

  it('validates payment failure, grace, dunning, recovery, suspension and dedupe', async () => {
    process.env.STRIPE_WEBHOOK_SECRET = webhookSecret;
    process.env.STRIPE_ENVIRONMENT = 'sandbox';

    const pro = await createPlan('pro', 499, 3);
    const recovery = await createPaidContext(pro);
    const failure = stripeEvent('invoice.payment_failed', invoiceObject({
      customerId: recovery.customerId,
      subscriptionId: recovery.subscriptionId,
      invoiceId: 'in_revenue_failed',
      paymentIntentId: 'pi_revenue_failed',
    }), 'evt_revenue_failed');

    await postStripeEvent(failure).expect(200);
    await postStripeEvent(failure).expect(200);

    let membership = await UserMembership.findById(recovery.membership._id).lean();
    const dunning = await DunningState.findOne({ userMembershipId: recovery.membership._id }).lean();
    expect(membership?.status).toBe('grace_period');
    expect(dunning?.status).toBe('active');
    expect(await Notification.countDocuments({ userId: recovery.user._id, type: 'membership_payment_failed' })).toBe(1);
    expect(await Notification.countDocuments({ userId: recovery.user._id, type: 'membership_grace_period_started' })).toBe(1);

    await DunningState.updateOne(
      { userMembershipId: recovery.membership._id },
      {
        $set: {
          graceEndsAt: new Date(Date.now() - 60_000),
          nextActionAt: new Date(Date.now() - 60_000),
          retrySchedule: [
            { day: 0, scheduledAt: new Date(Date.now() - 4 * 24 * 60 * 60_000), status: 'pending' },
            { day: 3, scheduledAt: new Date(Date.now() - 60_000), status: 'pending' },
            { day: 7, scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60_000), status: 'pending' },
          ],
        },
      }
    );

    const moved = await processDunningDue(new Date());
    membership = await UserMembership.findById(recovery.membership._id).lean();
    expect(moved.movedToDunning).toBe(1);
    expect(membership?.status).toBe('in_dunning');
    expect(await Notification.exists({ userId: recovery.user._id, type: 'membership_dunning_started' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(recovery.user._id), action: paymentAuditActions.dunningStarted })).toBeTruthy();

    await postStripeEvent(stripeEvent('invoice.paid', invoiceObject({
      customerId: recovery.customerId,
      subscriptionId: recovery.subscriptionId,
      invoiceId: 'in_revenue_recovered',
      paymentIntentId: 'pi_revenue_recovered',
    }), 'evt_revenue_recovered')).expect(200);

    membership = await UserMembership.findById(recovery.membership._id).lean();
    const recovered = await DunningState.findOne({ userMembershipId: recovery.membership._id }).lean();
    expect(membership?.status).toBe('active');
    expect(recovered?.status).toBe('recovered');
    expect(await Notification.exists({ userId: recovery.user._id, type: 'membership_recovered' })).toBeTruthy();

    const suspended = await createPaidContext(pro);
    await createTestListing(suspended.user._id);
    await postStripeEvent(stripeEvent('invoice.payment_failed', invoiceObject({
      customerId: suspended.customerId,
      subscriptionId: suspended.subscriptionId,
      invoiceId: 'in_revenue_suspend_failed',
      paymentIntentId: 'pi_revenue_suspend_failed',
    }), 'evt_revenue_suspend_failed')).expect(200);
    await DunningState.updateOne(
      { userMembershipId: suspended.membership._id },
      {
        $set: {
          nextActionAt: new Date(Date.now() - 60_000),
          retrySchedule: [
            { day: 0, scheduledAt: new Date(Date.now() - 8 * 24 * 60 * 60_000), status: 'pending' },
            { day: 3, scheduledAt: new Date(Date.now() - 5 * 24 * 60 * 60_000), status: 'pending' },
            { day: 7, scheduledAt: new Date(Date.now() - 60_000), status: 'pending' },
          ],
        },
      }
    );

    const suspendedResult = await processDunningDue(new Date());
    const suspendedMembership = await UserMembership.findById(suspended.membership._id).lean();
    expect(suspendedResult.suspended).toBe(1);
    expect(suspendedMembership?.status).toBe('suspended');
    expect((await canCreateListingByPolicy(suspended.user._id)).allowed).toBe(false);
    expect(await Listing.countDocuments({ seller: suspended.user._id })).toBe(1);
  });

  it('validates cancellation, reactivation and membership enforcement', async () => {
    const pro = await createPlan('pro', 499, 3);
    const cancelContext = await createPaidContext(pro, 'active', -1);
    const cancelToken = tokenFor(cancelContext.user);

    await request(app)
      .post('/account/membership/cancel')
      .set('Authorization', bearer(cancelToken))
      .send({ reason: 'validation' })
      .expect(200);
    const cancelledResult = await processMembershipPendingChanges(new Date());
    const cancelledPaid = await UserMembership.findById(cancelContext.membership._id).lean();
    const freeActive = await UserMembership.findOne({ userId: cancelContext.user._id, status: 'active' }).populate('planId');

    expect(cancelledResult.cancelled).toBe(1);
    expect(cancelledPaid?.status).toBe('cancelled');
    expect((freeActive?.planId as any).code).toBe('free');
    expect(await UserMembership.countDocuments({
      userId: cancelContext.user._id,
      status: { $in: ['active', 'grace_period', 'in_dunning'] },
    })).toBe(1);
    expect(await Notification.exists({ userId: cancelContext.user._id, type: 'membership_cancellation_completed' })).toBeTruthy();

    const reactivation = await createPaidContext(pro, 'active', 30);
    await request(app)
      .post('/account/membership/cancel')
      .set('Authorization', bearer(tokenFor(reactivation.user)))
      .send({ reason: 'reactivation validation' })
      .expect(200);
    await request(app)
      .post('/account/membership/reactivate')
      .set('Authorization', bearer(tokenFor(reactivation.user)))
      .expect(200);
    const reactivatedMembership = await UserMembership.findById(reactivation.membership._id).lean();
    expect(reactivatedMembership?.status).toBe('active');
    expect(reactivatedMembership?.cancelAtPeriodEnd).toBe(false);
    expect(reactivatedMembership?.pendingChangeType).toBeUndefined();
    expect(await canCreateListingByPolicy(reactivation.user._id)).toMatchObject({ allowed: true });
    expect(await Notification.exists({ userId: reactivation.user._id, type: 'membership_reactivation' })).toBeTruthy();
  });
});
