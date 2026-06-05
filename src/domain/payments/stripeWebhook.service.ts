import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan } from '../memberships/membershipPlan.model';
import { ensureDefaultMembershipPlans } from '../memberships/membership.seed';
import { ensureMembershipUsageForPeriod } from '../memberships/membership.service';
import {
  operationallyActiveMembershipStatuses,
  UserMembership,
} from '../memberships/userMembership.model';
import { User } from '../users/user.model';
import { recoverDunningForMembership, startDunningForPaymentFailure } from './dunning.service';
import { paymentAuditActions } from './payment.audit';
import { PaymentCheckoutSession } from './paymentCheckoutSession.model';
import { PaymentCustomer } from './paymentCustomer.model';
import { PaymentRecord } from './paymentRecord.model';
import { PaymentWebhookLog } from './paymentWebhookLog.model';
import { getStripeConfig, StripeConfig } from './stripe.config';

export const supportedStripeWebhookEvents = [
  'checkout.session.completed',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;

type StripeWebhookEventType = typeof supportedStripeWebhookEvents[number];

type StripeWebhookEvent = {
  id: string;
  type: string;
  data: {
    object: any;
  };
};

type WebhookResult = {
  ok: boolean;
  eventId?: string;
  eventType?: string;
  duplicate?: boolean;
  processed?: boolean;
  error?: string;
};

function sanitizeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/sk_(test|live)_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/whsec_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}

function hashPayload(rawBody: Buffer) {
  return createHash('sha256').update(rawBody).digest('hex');
}

function parseSignatureHeader(signatureHeader: string) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    })
  );

  return {
    timestamp: parts.t,
    signature: parts.v1,
  };
}

export function verifyStripeWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  webhookSecret: string | undefined
) {
  if (!webhookSecret) throw new Error('stripe_webhook_secret_missing');
  if (!signatureHeader) throw new Error('stripe_signature_missing');

  const { timestamp, signature } = parseSignatureHeader(signatureHeader);
  if (!timestamp || !signature) throw new Error('stripe_signature_invalid');

  const signedPayload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = createHmac('sha256', webhookSecret).update(signedPayload).digest('hex');
  const signatureBuffer = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (signatureBuffer.length !== expectedBuffer.length || !timingSafeEqual(signatureBuffer, expectedBuffer)) {
    throw new Error('stripe_signature_invalid');
  }

  const event = JSON.parse(rawBody.toString('utf8')) as StripeWebhookEvent;
  if (!event.id || !event.type || !event.data?.object) throw new Error('stripe_event_invalid');

  return event;
}

function isSupportedEvent(type: string): type is StripeWebhookEventType {
  return supportedStripeWebhookEvents.includes(type as StripeWebhookEventType);
}

function toObjectId(value: unknown) {
  if (value instanceof Types.ObjectId) return value;
  if (typeof value === 'string' && Types.ObjectId.isValid(value)) return new Types.ObjectId(value);
  return null;
}

function centsToAmount(value: unknown) {
  const cents = Number(value ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents) / 100;
}

function invoicePeriod(invoice: any) {
  const period = invoice?.lines?.data?.[0]?.period;
  const now = new Date();
  const start = period?.start ? new Date(Number(period.start) * 1000) : now;
  const end = period?.end ? new Date(Number(period.end) * 1000) : new Date(now.getTime() + 30 * 24 * 60 * 60_000);

  return { start, end };
}

function safePaymentMetadata(event: StripeWebhookEvent) {
  return {
    stripeEventId: event.id,
    stripeEventType: event.type,
  };
}

async function audit(actor: string, action: string) {
  await Audit.create({ actor, action });
}

async function findCorrelatedMembershipContext(object: any, config: StripeConfig) {
  const providerCustomerId = typeof object.customer === 'string' ? object.customer : '';
  if (!providerCustomerId) throw new Error('stripe_customer_missing');

  const customer = await PaymentCustomer.findOne({
    provider: 'stripe',
    providerEnvironment: config.environment,
    providerCustomerId,
    status: 'active',
  });
  if (!customer) throw new Error('payment_customer_not_found');

  const user = await User.findById(customer.userId).select('_id');
  if (!user) throw new Error('payment_user_not_found');

  const session = await PaymentCheckoutSession.findOne({
    provider: 'stripe',
    providerCustomerId,
    userId: customer.userId,
  }).sort({ createdAt: -1 });
  if (!session) throw new Error('payment_checkout_session_not_found');

  const plan = await MembershipPlan.findById(session.membershipPlanId);
  if (!plan || !plan.isActive) throw new Error('membership_plan_not_found');

  return { customer, session, plan, user };
}

async function deactivateOperationalMemberships(userId: Types.ObjectId, exceptId?: Types.ObjectId) {
  const filter: Record<string, unknown> = {
    userId,
    status: { $in: operationallyActiveMembershipStatuses },
  };
  if (exceptId) filter._id = { $ne: exceptId };

  await UserMembership.updateMany(filter, {
    $set: {
      status: 'expired',
      cancelledAt: new Date(),
    },
  });
}

async function ensureActiveFreeMembership(userId: Types.ObjectId) {
  const existingActive = await UserMembership.findOne({
    userId,
    status: { $in: operationallyActiveMembershipStatuses },
  });
  if (existingActive) return existingActive;

  const freePlan = await ensureDefaultMembershipPlans();
  if (!freePlan) throw new Error('free_membership_plan_not_found');
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 365 * 24 * 60 * 60_000);
  const membership = await UserMembership.create({
    userId,
    planId: freePlan._id,
    status: 'active',
    startsAt: now,
    currentPeriodStart: now,
    currentPeriodEnd: periodEnd,
    renewalMode: 'manual',
    source: 'stripe',
    paymentProvider: 'none',
  });
  await ensureMembershipUsageForPeriod(membership);
  return membership;
}

async function activatePaidMembership(params: {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  providerCustomerId: string;
  providerSubscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date;
}) {
  let membership = params.providerSubscriptionId
    ? await UserMembership.findOne({
      userId: params.userId,
      providerSubscriptionId: params.providerSubscriptionId,
      paymentProvider: 'stripe',
    })
    : null;

  if (membership) {
    await deactivateOperationalMemberships(params.userId, membership._id);
    membership.status = 'active';
    membership.planId = params.planId;
    membership.startsAt = membership.startsAt || params.periodStart;
    membership.currentPeriodStart = params.periodStart;
    membership.currentPeriodEnd = params.periodEnd;
    membership.renewalMode = 'automatic';
    membership.source = 'stripe';
    membership.paymentProvider = 'stripe';
    membership.providerCustomerId = params.providerCustomerId;
    membership.providerSubscriptionId = params.providerSubscriptionId;
    membership.lastPaymentAt = params.paidAt;
    membership.cancelledAt = undefined;
    membership.suspendedAt = undefined;
    await membership.save();
  } else {
    await deactivateOperationalMemberships(params.userId);
    membership = await UserMembership.create({
      userId: params.userId,
      planId: params.planId,
      status: 'active',
      startsAt: params.periodStart,
      currentPeriodStart: params.periodStart,
      currentPeriodEnd: params.periodEnd,
      renewalMode: 'automatic',
      source: 'stripe',
      paymentProvider: 'stripe',
      providerCustomerId: params.providerCustomerId,
      providerSubscriptionId: params.providerSubscriptionId,
      lastPaymentAt: params.paidAt,
    });
  }

  await ensureMembershipUsageForPeriod(membership);
  return membership;
}

async function upsertPaymentRecord(params: {
  event: StripeWebhookEvent;
  userId: Types.ObjectId;
  membershipPlanId: Types.ObjectId;
  userMembershipId?: Types.ObjectId;
  providerEnvironment: StripeConfig['environment'];
  providerCustomerId?: string;
  providerInvoiceId?: string;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  status: 'succeeded' | 'failed';
  amount: number;
  failureReason?: string;
  occurredAt: Date;
}) {
  const filter = params.providerInvoiceId
    ? {
      provider: 'stripe',
      providerEnvironment: params.providerEnvironment,
      providerInvoiceId: params.providerInvoiceId,
    }
    : {
      provider: 'stripe',
      providerEnvironment: params.providerEnvironment,
      providerPaymentId: params.providerPaymentId,
    };

  return PaymentRecord.findOneAndUpdate(
    filter,
    {
      $set: {
        userId: params.userId,
        membershipPlanId: params.membershipPlanId,
        userMembershipId: params.userMembershipId,
        provider: 'stripe',
        providerEnvironment: params.providerEnvironment,
        providerPaymentId: params.providerPaymentId,
        providerInvoiceId: params.providerInvoiceId,
        providerSubscriptionId: params.providerSubscriptionId,
        providerCustomerId: params.providerCustomerId,
        type: 'membership',
        status: params.status,
        amount: params.amount,
        currency: 'MXN',
        metadata: safePaymentMetadata(params.event),
        paidAt: params.status === 'succeeded' ? params.occurredAt : undefined,
        failedAt: params.status === 'failed' ? params.occurredAt : undefined,
        failureReason: params.failureReason,
      },
    },
    { upsert: true, new: true, runValidators: true }
  );
}

async function handleCheckoutCompleted(event: StripeWebhookEvent, config: StripeConfig) {
  const sessionObject = event.data.object;
  const providerSessionId = String(sessionObject.id || '');
  const providerCustomerId = typeof sessionObject.customer === 'string' ? sessionObject.customer : '';
  const checkoutRequestId = typeof sessionObject.metadata?.checkoutRequestId === 'string'
    ? sessionObject.metadata.checkoutRequestId
    : '';

  const session = await PaymentCheckoutSession.findOneAndUpdate(
    checkoutRequestId ? { checkoutRequestId } : { providerSessionId },
    {
      $set: {
        providerSessionId,
        providerCustomerId,
        status: 'completed',
      },
    },
    { new: true, runValidators: true }
  );

  if (session && providerCustomerId) {
    await PaymentCustomer.findOneAndUpdate(
      {
        userId: session.userId,
        provider: 'stripe',
        providerEnvironment: config.environment,
      },
      {
        $set: {
          providerCustomerId,
          status: 'active',
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
  }

  await audit(session ? String(session.userId) : 'stripe', paymentAuditActions.webhookProcessed);
}

async function handleInvoicePaid(event: StripeWebhookEvent, config: StripeConfig) {
  const invoice = event.data.object;
  const { customer, session } = await findCorrelatedMembershipContext(invoice, config);
  const providerSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : '';
  if (!providerSubscriptionId) throw new Error('stripe_subscription_missing');

  const period = invoicePeriod(invoice);
  const paidAt = invoice.status_transitions?.paid_at
    ? new Date(Number(invoice.status_transitions.paid_at) * 1000)
    : new Date();

  const membership = await activatePaidMembership({
    userId: customer.userId,
    planId: session.membershipPlanId,
    providerCustomerId: customer.providerCustomerId,
    providerSubscriptionId,
    periodStart: period.start,
    periodEnd: period.end,
    paidAt,
  });

  await upsertPaymentRecord({
    event,
    userId: customer.userId,
    membershipPlanId: session.membershipPlanId,
    userMembershipId: membership._id,
    providerEnvironment: config.environment,
    providerCustomerId: customer.providerCustomerId,
    providerInvoiceId: typeof invoice.id === 'string' ? invoice.id : undefined,
    providerPaymentId: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : undefined,
    providerSubscriptionId,
    status: 'succeeded',
    amount: centsToAmount(invoice.amount_paid),
    occurredAt: paidAt,
  });

  await recoverDunningForMembership({
    userId: customer.userId,
    userMembershipId: membership._id,
    recoveredAt: paidAt,
  });

  await audit(String(customer.userId), paymentAuditActions.paymentSucceeded);
  await audit(String(customer.userId), paymentAuditActions.webhookProcessed);
}

async function handleInvoicePaymentFailed(event: StripeWebhookEvent, config: StripeConfig) {
  const invoice = event.data.object;
  const { customer, session } = await findCorrelatedMembershipContext(invoice, config);
  const providerSubscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : '';
  const failedAt = new Date();

  const membership = providerSubscriptionId
    ? await UserMembership.findOne({
      userId: customer.userId,
      providerSubscriptionId,
      paymentProvider: 'stripe',
    })
    : null;

  const paymentRecord = await upsertPaymentRecord({
    event,
    userId: customer.userId,
    membershipPlanId: session.membershipPlanId,
    userMembershipId: membership?._id,
    providerEnvironment: config.environment,
    providerCustomerId: customer.providerCustomerId,
    providerInvoiceId: typeof invoice.id === 'string' ? invoice.id : undefined,
    providerPaymentId: typeof invoice.payment_intent === 'string' ? invoice.payment_intent : undefined,
    providerSubscriptionId,
    status: 'failed',
    amount: centsToAmount(invoice.amount_due ?? invoice.amount_paid),
    failureReason: 'invoice_payment_failed',
    occurredAt: failedAt,
  });

  if (membership) {
    await startDunningForPaymentFailure({
      userId: customer.userId,
      userMembershipId: membership._id,
      paymentRecordId: paymentRecord._id,
      failedAt,
      failureReason: 'invoice_payment_failed',
    });
  } else {
    await audit(String(customer.userId), paymentAuditActions.paymentFailed);
  }

  await audit(String(customer.userId), paymentAuditActions.webhookProcessed);
}

async function handleSubscriptionUpdated(event: StripeWebhookEvent, config: StripeConfig) {
  const subscription = event.data.object;
  const providerCustomerId = typeof subscription.customer === 'string' ? subscription.customer : '';
  const providerSubscriptionId = typeof subscription.id === 'string' ? subscription.id : '';

  const customer = providerCustomerId
    ? await PaymentCustomer.findOne({
      provider: 'stripe',
      providerEnvironment: config.environment,
      providerCustomerId,
      status: 'active',
    })
    : null;

  if (customer && providerSubscriptionId) {
    await UserMembership.findOneAndUpdate(
      {
        userId: customer.userId,
        providerSubscriptionId,
        paymentProvider: 'stripe',
      },
      {
        $set: {
          nextBillingAt: subscription.current_period_end
            ? new Date(Number(subscription.current_period_end) * 1000)
            : undefined,
        },
      },
      { new: true, runValidators: true }
    );
    await audit(String(customer.userId), paymentAuditActions.subscriptionUpdated);
  }

  await audit(customer ? String(customer.userId) : 'stripe', paymentAuditActions.webhookProcessed);
}

async function handleSubscriptionDeleted(event: StripeWebhookEvent, config: StripeConfig) {
  const subscription = event.data.object;
  const providerCustomerId = typeof subscription.customer === 'string' ? subscription.customer : '';
  const providerSubscriptionId = typeof subscription.id === 'string' ? subscription.id : '';

  const customer = providerCustomerId
    ? await PaymentCustomer.findOne({
      provider: 'stripe',
      providerEnvironment: config.environment,
      providerCustomerId,
      status: 'active',
    })
    : null;
  if (!customer || !providerSubscriptionId) throw new Error('subscription_correlation_failed');

  await UserMembership.findOneAndUpdate(
    {
      userId: customer.userId,
      providerSubscriptionId,
      paymentProvider: 'stripe',
    },
    {
      $set: {
        status: 'cancelled',
        cancelledAt: new Date(),
      },
    },
    { new: true, runValidators: true }
  );
  await ensureActiveFreeMembership(customer.userId);

  await audit(String(customer.userId), paymentAuditActions.subscriptionCancelled);
  await audit(String(customer.userId), paymentAuditActions.revertedToFree);
  await audit(String(customer.userId), paymentAuditActions.webhookProcessed);
}

async function processStripeEvent(event: StripeWebhookEvent, config: StripeConfig) {
  if (!isSupportedEvent(event.type)) return;

  if (event.type === 'checkout.session.completed') return handleCheckoutCompleted(event, config);
  if (event.type === 'invoice.paid') return handleInvoicePaid(event, config);
  if (event.type === 'invoice.payment_failed') return handleInvoicePaymentFailed(event, config);
  if (event.type === 'customer.subscription.updated') return handleSubscriptionUpdated(event, config);
  if (event.type === 'customer.subscription.deleted') return handleSubscriptionDeleted(event, config);
}

export async function handleStripeWebhook(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  config: StripeConfig = getStripeConfig()
): Promise<WebhookResult> {
  let event: StripeWebhookEvent;
  try {
    event = verifyStripeWebhookSignature(rawBody, signatureHeader, config.webhookSecret);
  } catch (error) {
    return { ok: false, error: sanitizeError(error) };
  }

  const payloadHash = hashPayload(rawBody);
  let log = await PaymentWebhookLog.findOne({ provider: 'stripe', providerEventId: event.id });
  if (log?.processed) {
    return { ok: true, eventId: event.id, eventType: event.type, duplicate: true, processed: true };
  }

  if (!log) {
    log = await PaymentWebhookLog.create({
      provider: 'stripe',
      providerEventId: event.id,
      eventType: event.type,
      payloadHash,
      processed: false,
      attempts: 1,
    });
  } else {
    log.eventType = event.type;
    log.payloadHash = payloadHash;
    log.attempts += 1;
    log.lastError = undefined;
    await log.save();
  }

  await audit('stripe', paymentAuditActions.webhookReceived);

  try {
    await processStripeEvent(event, config);
    log.processed = true;
    log.processedAt = new Date();
    log.lastError = undefined;
    await log.save();

    return { ok: true, eventId: event.id, eventType: event.type, processed: true };
  } catch (error) {
    const lastError = sanitizeError(error);
    log.processed = false;
    log.lastError = lastError;
    await log.save();
    await audit('stripe', paymentAuditActions.webhookFailed);

    return { ok: false, eventId: event.id, eventType: event.type, processed: false, error: lastError };
  }
}
