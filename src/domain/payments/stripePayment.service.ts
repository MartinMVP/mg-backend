import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan } from '../memberships/membershipPlan.model';
import { User } from '../users/user.model';
import { paymentAuditActions } from './payment.audit';
import { PaymentCheckoutSession } from './paymentCheckoutSession.model';
import { PaymentCustomer } from './paymentCustomer.model';
import { getStripeConfig, StripeConfig, validateStripeConfig } from './stripe.config';

type CheckoutRequest = {
  userId: string;
  planCode: string;
};

type StripeCustomerInput = {
  userId: string;
  email?: string;
  name?: string;
};

type StripeCheckoutSessionInput = {
  checkoutRequestId: string;
  customerId: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
};

export type StripeCustomerResult = {
  id: string;
};

export type StripeCheckoutSessionResult = {
  id: string;
  url: string;
  expiresAt?: Date;
};

export type StripeCheckoutClient = {
  createCustomer(input: StripeCustomerInput, config: StripeConfig): Promise<StripeCustomerResult>;
  createCheckoutSession(
    input: StripeCheckoutSessionInput,
    config: StripeConfig
  ): Promise<StripeCheckoutSessionResult>;
};

function toObjectId(id: string) {
  return new Types.ObjectId(id);
}

function sanitizeError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/sk_(test|live)_[A-Za-z0-9_=-]+/g, 'sk_$1_[redacted]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 300);
}

function requireStripeSecret(config: StripeConfig) {
  if (!config.secretKey) throw new Error('stripe_secret_key_missing');
  return config.secretKey;
}

function stripeApiUrl(config: StripeConfig, path: string) {
  const base = (config.apiUrl || 'https://api.stripe.com').replace(/\/+$/, '');
  return `${base}${path}`;
}

async function stripePost(
  config: StripeConfig,
  path: string,
  body: URLSearchParams,
  idempotencyKey: string
) {
  const response = await fetch(stripeApiUrl(config, path), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${requireStripeSecret(config)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.error?.message === 'string'
      ? payload.error.message
      : `stripe_http_${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export const defaultStripeCheckoutClient: StripeCheckoutClient = {
  async createCustomer(input, config) {
    const body = new URLSearchParams();
    if (input.email) body.set('email', input.email);
    if (input.name) body.set('name', input.name);
    body.set('metadata[userId]', input.userId);

    const payload = await stripePost(
      config,
      '/v1/customers',
      body,
      `customer_${input.userId}_sandbox`
    );
    if (!payload?.id || typeof payload.id !== 'string') {
      throw new Error('stripe_customer_id_missing');
    }

    return { id: payload.id };
  },

  async createCheckoutSession(input, config) {
    const body = new URLSearchParams();
    body.set('mode', 'subscription');
    body.set('customer', input.customerId);
    body.set('line_items[0][price]', input.priceId);
    body.set('line_items[0][quantity]', '1');
    body.set('success_url', input.successUrl);
    body.set('cancel_url', input.cancelUrl);
    for (const [key, value] of Object.entries(input.metadata)) {
      body.set(`metadata[${key}]`, value);
    }

    const payload = await stripePost(
      config,
      '/v1/checkout/sessions',
      body,
      input.checkoutRequestId
    );
    if (!payload?.id || typeof payload.id !== 'string') {
      throw new Error('stripe_checkout_session_id_missing');
    }
    if (!payload?.url || typeof payload.url !== 'string') {
      throw new Error('stripe_checkout_url_missing');
    }

    const expiresAt = typeof payload.expires_at === 'number'
      ? new Date(payload.expires_at * 1000)
      : undefined;

    return { id: payload.id, url: payload.url, expiresAt };
  },
};

async function createFailedCheckoutSession(
  input: CheckoutRequest,
  plan: any,
  config: StripeConfig,
  error: string,
  issues?: string[]
) {
  const session = await PaymentCheckoutSession.create({
    userId: toObjectId(input.userId),
    membershipPlanId: plan._id,
    provider: 'stripe',
    providerEnvironment: 'sandbox',
    checkoutRequestId: `checkout_${randomUUID()}`,
    mode: 'subscription',
    status: 'failed',
    amount: plan.price,
    currency: plan.currency,
    successUrl: config.successUrl,
    cancelUrl: config.cancelUrl,
    metadata: {
      checkoutRequestId: undefined,
      membershipPlanCode: plan.code,
      membershipPlanId: String(plan._id),
      userId: input.userId,
    },
  });

  await Audit.create({
    actor: input.userId,
    action: paymentAuditActions.membershipCheckoutFailed,
    metadata: { error, issues, checkoutRequestId: session.checkoutRequestId },
  });

  return session;
}

export async function requestMembershipCheckout(
  input: CheckoutRequest,
  config: StripeConfig = getStripeConfig(),
  client: StripeCheckoutClient = defaultStripeCheckoutClient
) {
  const planCode = input.planCode?.toLowerCase().trim();
  if (!planCode) return { status: 400, body: { ok: false, error: 'plan_code_required' } };

  const plan = await MembershipPlan.findOne({ code: planCode });
  if (!plan) return { status: 404, body: { ok: false, error: 'membership_plan_not_found' } };
  if (!plan.isActive) return { status: 409, body: { ok: false, error: 'membership_plan_inactive' } };
  if (!plan.isPublic) return { status: 409, body: { ok: false, error: 'membership_plan_not_public' } };
  if (plan.code === 'free') return { status: 400, body: { ok: false, error: 'free_plan_checkout_not_allowed' } };
  if (!plan.stripePriceId) return { status: 409, body: { ok: false, error: 'stripe_price_id_missing' } };
  if (!String(plan.stripePriceId).startsWith('price_')) {
    return { status: 409, body: { ok: false, error: 'stripe_price_id_invalid' } };
  }

  await Audit.create({
    actor: input.userId,
    action: paymentAuditActions.membershipCheckoutRequested,
  });

  const validation = validateStripeConfig(config);

  if (!config.enabled) {
    const session = await createFailedCheckoutSession(input, plan, config, 'stripe_disabled');
    return {
      status: 200,
      body: {
        ok: false,
        error: 'stripe_disabled',
        checkoutRequestId: session.checkoutRequestId,
      },
    };
  }

  if (!validation.ok) {
    const session = await createFailedCheckoutSession(
      input,
      plan,
      config,
      'stripe_not_configured',
      validation.issues
    );
    return {
      status: 409,
      body: {
        ok: false,
        error: 'stripe_not_configured',
        issues: validation.issues,
        checkoutRequestId: session.checkoutRequestId,
      },
    };
  }

  const now = new Date();
  const existingSession = await PaymentCheckoutSession.findOne({
    userId: toObjectId(input.userId),
    membershipPlanId: plan._id,
    provider: 'stripe',
    providerEnvironment: 'sandbox',
    status: 'open',
    providerSessionId: { $exists: true, $ne: '' },
    expiresAt: { $gt: now },
  }).sort({ createdAt: -1 });

  if (existingSession?.checkoutUrl) {
    return {
      status: 200,
      body: {
        ok: true,
        checkoutUrl: existingSession.checkoutUrl,
        sessionId: existingSession.providerSessionId,
        checkoutRequestId: existingSession.checkoutRequestId,
      },
    };
  }

  try {
    const user = await User.findById(input.userId).lean();
    if (!user) return { status: 404, body: { ok: false, error: 'user_not_found' } };

    let customer = await PaymentCustomer.findOne({
      userId: toObjectId(input.userId),
      provider: 'stripe',
      providerEnvironment: 'sandbox',
    });

    if (!customer) {
      const stripeCustomer = await client.createCustomer({
        userId: input.userId,
        email: user.email,
        name: user.name,
      }, config);

      customer = await PaymentCustomer.create({
        userId: toObjectId(input.userId),
        provider: 'stripe',
        providerEnvironment: 'sandbox',
        providerCustomerId: stripeCustomer.id,
        email: user.email,
        name: user.name,
        status: 'active',
      });

      await Audit.create({
        actor: input.userId,
        action: paymentAuditActions.stripeCustomerCreated,
        metadata: { providerEnvironment: 'sandbox' },
      });
    }

    const checkoutRequestId = `checkout_${randomUUID()}`;
    const metadata = {
      checkoutRequestId,
      userId: input.userId,
      membershipPlanId: String(plan._id),
      membershipPlanCode: plan.code,
    };

    const checkout = await client.createCheckoutSession({
      checkoutRequestId,
      customerId: customer.providerCustomerId,
      priceId: plan.stripePriceId,
      successUrl: config.successUrl!,
      cancelUrl: config.cancelUrl!,
      metadata,
    }, config);

    const expiresAt = checkout.expiresAt && checkout.expiresAt > now
      ? checkout.expiresAt
      : undefined;

    const session = await PaymentCheckoutSession.create({
      userId: toObjectId(input.userId),
      membershipPlanId: plan._id,
      provider: 'stripe',
      providerEnvironment: 'sandbox',
      providerSessionId: checkout.id,
      providerCustomerId: customer.providerCustomerId,
      checkoutRequestId,
      mode: 'subscription',
      status: 'open',
      amount: plan.price,
      currency: plan.currency,
      successUrl: config.successUrl,
      cancelUrl: config.cancelUrl,
      checkoutUrl: checkout.url,
      expiresAt,
      metadata,
    });

    await Audit.create({
      actor: input.userId,
      action: paymentAuditActions.membershipCheckoutCreated,
      metadata: {
        checkoutRequestId: session.checkoutRequestId,
        providerEnvironment: 'sandbox',
      },
    });

    return {
      status: 200,
      body: {
        ok: true,
        checkoutUrl: checkout.url,
        sessionId: checkout.id,
        checkoutRequestId: session.checkoutRequestId,
      },
    };
  } catch (error) {
    const message = sanitizeError(error);
    const session = await createFailedCheckoutSession(input, plan, config, message);

    return {
      status: 502,
      body: {
        ok: false,
        error: 'stripe_checkout_failed',
        message,
        checkoutRequestId: session.checkoutRequestId,
      },
    };
  }
}
