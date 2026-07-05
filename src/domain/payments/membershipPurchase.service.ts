import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan } from '../memberships/membershipPlan.model';
import { activateMembershipFromPaymentConfirmed, createMembership } from '../memberships/membershipFoundation.service';
import { UserMembership } from '../memberships/userMembership.model';
import { Notification } from '../notifications/notification.model';
import { User } from '../users/user.model';
import { MembershipPaymentSession } from './membershipPaymentSession.model';
import { MembershipPaymentTransaction } from './membershipPaymentTransaction.model';
import { PaymentCheckoutSession } from './paymentCheckoutSession.model';
import { PaymentCustomer } from './paymentCustomer.model';
import { PaymentRecord } from './paymentRecord.model';
import { PaymentWebhookLog } from './paymentWebhookLog.model';
import { paymentAuditActions } from './payment.audit';
import { PaymentConfirmed } from './paymentConfirmed.event';
import { defaultStripeCheckoutClient, StripeCheckoutClient } from './stripePayment.service';
import { getStripeConfig, StripeConfig, validateStripeConfig } from './stripe.config';
import { verifyStripeWebhookSignature } from './stripeWebhook.service';

type CheckoutInput = {
  userId: string;
  planId?: string;
  planCode?: string;
};

type StripeEvent = {
  id: string;
  type: string;
  data: { object: any };
};

const dayMs = 24 * 60 * 60_000;

function toObjectId(id: string) {
  return new Types.ObjectId(id);
}

function payloadHash(rawBody: Buffer) {
  return createHash('sha256').update(rawBody).digest('hex');
}

function sanitizeError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/sk_(test|live)_[A-Za-z0-9_=-]+/g, 'sk_$1_[redacted]')
    .replace(/whsec_[A-Za-z0-9_=-]+/g, 'whsec_[redacted]')
    .slice(0, 300);
}

function centsToAmount(value: unknown) {
  const cents = Number(value ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents) / 100;
}

function eventObjectAmount(object: any, fallback: number) {
  return centsToAmount(object.amount_total ?? object.amount_paid ?? object.amount_due) || fallback;
}

async function audit(actor: string, action: string) {
  await Audit.create({ actor, action });
}

async function notify(userId: Types.ObjectId, type: any, title: string, message: string) {
  await Notification.create({ userId, type, title, message, read: false });
}

async function findPlan(input: CheckoutInput) {
  if (input.planId) {
    if (!Types.ObjectId.isValid(input.planId)) return null;
    return MembershipPlan.findById(input.planId);
  }
  const code = String(input.planCode || '').toLowerCase().trim();
  if (!code) return null;
  return MembershipPlan.findOne({ code });
}

async function hasActivePaidMembership(userId: Types.ObjectId) {
  const active = await UserMembership.findOne({ userId, status: 'active' }).populate('planId');
  if (!active) return false;
  const plan = active.planId as any;
  return plan?.code !== 'free';
}

async function ensureStripeCustomer(user: any, config: StripeConfig, client: StripeCheckoutClient) {
  let customer = await PaymentCustomer.findOne({
    userId: user._id,
    provider: 'stripe',
    providerEnvironment: config.environment,
  });
  if (customer) return customer;

  const stripeCustomer = await client.createCustomer({ userId: String(user._id), email: user.email, name: user.name }, config);
  customer = await PaymentCustomer.create({
    userId: user._id,
    provider: 'stripe',
    providerEnvironment: config.environment,
    providerCustomerId: stripeCustomer.id,
    email: user.email,
    name: user.name,
    status: 'active',
  });
  return customer;
}

export async function requestMembershipPurchaseCheckout(
  input: CheckoutInput,
  config: StripeConfig = getStripeConfig(),
  client: StripeCheckoutClient = defaultStripeCheckoutClient
) {
  if (!Types.ObjectId.isValid(input.userId)) return { status: 400, body: { ok: false, error: 'invalid_user_id' } };
  const user = await User.findById(input.userId);
  if (!user) return { status: 404, body: { ok: false, error: 'user_not_found' } };

  const plan = await findPlan(input);
  if (!plan) return { status: 404, body: { ok: false, error: 'membership_plan_not_found' } };
  if (!plan.isActive) return { status: 409, body: { ok: false, error: 'membership_plan_inactive' } };
  if (plan.code === 'free') return { status: 400, body: { ok: false, error: 'free_plan_checkout_not_allowed' } };
  if (await hasActivePaidMembership(user._id)) return { status: 409, body: { ok: false, error: 'active_membership_exists' } };
  if (!plan.stripePriceId) return { status: 409, body: { ok: false, error: 'stripe_price_id_missing' } };

  const validation = validateStripeConfig(config);
  if (!config.enabled || !validation.ok) {
    return {
      status: 409,
      body: { ok: false, error: 'stripe_not_configured', issues: validation.issues },
    };
  }

  const now = new Date();
  const existingSession = await MembershipPaymentSession.findOne({
    userId: user._id,
    planId: plan._id,
    status: { $in: ['checkout_created', 'payment_pending'] },
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });
  if (existingSession?.checkoutUrl) {
    return {
      status: 200,
      body: {
        ok: true,
        checkoutUrl: existingSession.checkoutUrl,
        sessionId: existingSession.stripeCheckoutSessionId,
        paymentSessionId: String(existingSession._id),
      },
    };
  }

  const membership = await createMembership({
    userId: String(user._id),
    planId: String(plan._id),
    metadata: { source: 'membership_checkout' },
  }, String(user._id));

  const customer = await ensureStripeCustomer(user, config, client);
  const checkoutRequestId = `membership_checkout_${randomUUID()}`;
  const metadata = {
    checkoutRequestId,
    userId: String(user._id),
    planId: String(plan._id),
    membershipId: String(membership._id),
  };
  const checkout = await client.createCheckoutSession({
    checkoutRequestId,
    customerId: customer.providerCustomerId,
    priceId: plan.stripePriceId,
    successUrl: config.successUrl!,
    cancelUrl: config.cancelUrl!,
    metadata,
  }, config);

  const expiresAt = checkout.expiresAt ?? new Date(Date.now() + 30 * 60_000);
  const session = await MembershipPaymentSession.create({
    userId: user._id,
    planId: plan._id,
    membershipId: membership._id,
    stripeCheckoutSessionId: checkout.id,
    checkoutRequestId,
    status: 'checkout_created',
    amount: Number(plan.monthlyPrice ?? plan.price ?? 0),
    currency: 'MXN',
    checkoutUrl: checkout.url,
    expiresAt,
    metadata,
  });

  await PaymentCheckoutSession.create({
    userId: user._id,
    membershipPlanId: plan._id,
    provider: 'stripe',
    providerEnvironment: config.environment,
    providerSessionId: checkout.id,
    providerCustomerId: customer.providerCustomerId,
    checkoutRequestId,
    mode: 'subscription',
    status: 'open',
    amount: session.amount,
    currency: 'MXN',
    successUrl: config.successUrl,
    cancelUrl: config.cancelUrl,
    checkoutUrl: checkout.url,
    expiresAt,
    metadata: { checkoutRequestId, userId: String(user._id), membershipPlanId: String(plan._id), membershipPlanCode: plan.code },
  });

  await audit(String(user._id), 'PAYMENT_CHECKOUT_CREATED');

  return {
    status: 201,
    body: {
      ok: true,
      checkoutUrl: checkout.url,
      sessionId: checkout.id,
      paymentSessionId: String(session._id),
      membershipId: String(membership._id),
    },
  };
}

async function createPaymentRecordFromTransaction(transaction: any, session: any, event: StripeEvent, status: 'succeeded' | 'failed' | 'cancelled') {
  return PaymentRecord.findOneAndUpdate(
    {
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerPaymentId: transaction.stripePaymentIntentId || transaction.stripeEventId,
    },
    {
      $set: {
        userId: transaction.userId,
        membershipPlanId: transaction.planId,
        userMembershipId: transaction.membershipId,
        provider: 'stripe',
        providerEnvironment: 'sandbox',
        providerPaymentId: transaction.stripePaymentIntentId || transaction.stripeEventId,
        type: 'membership',
        status,
        amount: transaction.amount,
        currency: transaction.currency,
        metadata: { stripeEventId: event.id, stripeEventType: event.type, membershipPaymentSessionId: String(session._id) },
        paidAt: status === 'succeeded' ? transaction.processedAt : undefined,
        failedAt: status === 'failed' ? transaction.processedAt : undefined,
        failureReason: status === 'failed' ? event.type : undefined,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

async function handleCheckoutCompleted(event: StripeEvent) {
  const object = event.data.object;
  const stripeCheckoutSessionId = String(object.id || '');
  const session = await MembershipPaymentSession.findOne({ stripeCheckoutSessionId });
  if (!session) throw new Error('membership_payment_session_not_found');

  if (session.status === 'payment_confirmed') return { duplicateEffect: true };

  const processedAt = new Date();
  const transaction = await MembershipPaymentTransaction.create({
    userId: session.userId,
    planId: session.planId,
    membershipId: session.membershipId,
    stripeCheckoutSessionId,
    stripePaymentIntentId: typeof object.payment_intent === 'string' ? object.payment_intent : undefined,
    stripeEventId: event.id,
    status: 'payment_confirmed',
    amount: eventObjectAmount(object, session.amount),
    currency: 'MXN',
    processedAt,
    metadata: { stripeEventType: event.type },
  });

  session.status = 'payment_confirmed';
  session.completedAt = processedAt;
  await session.save();
  await PaymentCheckoutSession.findOneAndUpdate({ providerSessionId: stripeCheckoutSessionId }, { $set: { status: 'completed' } });
  await createPaymentRecordFromTransaction(transaction, session, event, 'succeeded');
  await audit(String(session.userId), 'PAYMENT_CONFIRMED');
  await notify(session.userId, 'payment_confirmed', 'Pago confirmado', 'Tu pago de membresía fue confirmado.');

  const paymentConfirmed: PaymentConfirmed = {
    userId: session.userId,
    planId: session.planId,
    membershipId: session.membershipId!,
    paymentTransactionId: transaction._id,
    amount: transaction.amount,
    currency: transaction.currency,
    confirmedAt: processedAt,
  };
  await activateMembershipFromPaymentConfirmed(paymentConfirmed);
  return { transaction };
}

async function handleCheckoutExpired(event: StripeEvent) {
  const object = event.data.object;
  const session = await MembershipPaymentSession.findOneAndUpdate(
    { stripeCheckoutSessionId: String(object.id || '') },
    { $set: { status: 'checkout_expired' } },
    { new: true }
  );
  if (session) await PaymentCheckoutSession.findOneAndUpdate({ providerSessionId: session.stripeCheckoutSessionId }, { $set: { status: 'expired' } });
  await audit(session ? String(session.userId) : 'stripe', 'PAYMENT_CANCELLED');
  return { session };
}

async function handlePaymentFailed(event: StripeEvent) {
  const object = event.data.object;
  const stripeCheckoutSessionId = String(object.id || object.checkout_session || object.metadata?.stripeCheckoutSessionId || '');
  const session = stripeCheckoutSessionId ? await MembershipPaymentSession.findOne({ stripeCheckoutSessionId }) : null;
  if (session) {
    const processedAt = new Date();
    const transaction = await MembershipPaymentTransaction.create({
      userId: session.userId,
      planId: session.planId,
      membershipId: session.membershipId,
      stripeCheckoutSessionId: session.stripeCheckoutSessionId,
      stripePaymentIntentId: typeof object.payment_intent === 'string' ? object.payment_intent : undefined,
      stripeEventId: event.id,
      status: 'payment_failed',
      amount: eventObjectAmount(object, session.amount),
      currency: 'MXN',
      processedAt,
      metadata: { stripeEventType: event.type },
    });
    session.status = 'payment_failed';
    await session.save();
    await createPaymentRecordFromTransaction(transaction, session, event, 'failed');
    await notify(session.userId, 'payment_failed', 'Pago fallido', 'No fue posible confirmar tu pago de membresía.');
    await audit(String(session.userId), 'PAYMENT_FAILED');
  } else {
    await audit('stripe', 'PAYMENT_FAILED');
  }
}

async function processMembershipPaymentEvent(event: StripeEvent) {
  if (event.type === 'checkout.session.completed') return handleCheckoutCompleted(event);
  if (event.type === 'checkout.session.expired') return handleCheckoutExpired(event);
  if (event.type === 'checkout.session.async_payment_failed' || event.type === 'payment_intent.payment_failed') {
    return handlePaymentFailed(event);
  }
  throw new Error('unsupported_membership_payment_event');
}

export async function handleMembershipStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  config: StripeConfig = getStripeConfig()
) {
  let event: StripeEvent;
  try {
    event = verifyStripeWebhookSignature(rawBody, signatureHeader, config.webhookSecret) as StripeEvent;
  } catch (error) {
    await audit('stripe', 'PAYMENT_WEBHOOK_INVALID');
    return { ok: false, status: 400, body: { ok: false, error: sanitizeError(error) } };
  }

  if (!event.id || !event.type || !event.data?.object) {
    await audit('stripe', 'PAYMENT_WEBHOOK_INVALID');
    return { ok: false, status: 400, body: { ok: false, error: 'stripe_event_invalid' } };
  }

  const hash = payloadHash(rawBody);
  const existing = await PaymentWebhookLog.findOne({ provider: 'stripe', providerEventId: event.id });
  if (existing?.processed) {
    await audit('stripe', 'PAYMENT_WEBHOOK_DUPLICATE_IGNORED');
    return { ok: true, status: 200, body: { ok: true, eventId: event.id, duplicate: true, processed: true } };
  }

  const log = existing || await PaymentWebhookLog.create({
    provider: 'stripe',
    providerEventId: event.id,
    eventType: event.type,
    payloadHash: hash,
    processed: false,
    attempts: 0,
  });
  log.eventType = event.type;
  log.payloadHash = hash;
  log.attempts += 1;
  await log.save();
  await audit('stripe', 'PAYMENT_WEBHOOK_RECEIVED');

  try {
    await processMembershipPaymentEvent(event);
    log.processed = true;
    log.processedAt = new Date();
    log.lastError = undefined;
    await log.save();
    return { ok: true, status: 200, body: { ok: true, eventId: event.id, eventType: event.type, processed: true } };
  } catch (error: any) {
    if (error?.code === 11000) {
      log.processed = true;
      log.processedAt = new Date();
      log.lastError = undefined;
      await log.save();
      await audit('stripe', 'PAYMENT_WEBHOOK_DUPLICATE_IGNORED');
      return { ok: true, status: 200, body: { ok: true, eventId: event.id, duplicate: true, processed: true } };
    }
    log.lastError = sanitizeError(error);
    await log.save();
    await audit('stripe', 'PAYMENT_WEBHOOK_INVALID');
    return { ok: false, status: 422, body: { ok: false, eventId: event.id, error: log.lastError } };
  }
}

export async function getMembershipPaymentForUser(id: string, userId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  return MembershipPaymentTransaction.findOne({ _id: id, userId: toObjectId(userId) }).lean();
}
