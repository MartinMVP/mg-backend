import { randomUUID } from 'crypto';
import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { MembershipPlan } from '../memberships/membershipPlan.model';
import { paymentAuditActions } from './payment.audit';
import { PaymentCheckoutSession } from './paymentCheckoutSession.model';
import { getStripeConfig, StripeConfig, validateStripeConfig } from './stripe.config';

type CheckoutRequest = {
  userId: string;
  planCode: string;
};

function toObjectId(id: string) {
  return new Types.ObjectId(id);
}

export async function requestMembershipCheckout(
  input: CheckoutRequest,
  config: StripeConfig = getStripeConfig()
) {
  const planCode = input.planCode?.toLowerCase().trim();
  if (!planCode) return { status: 400, body: { ok: false, error: 'plan_code_required' } };

  const plan = await MembershipPlan.findOne({ code: planCode });
  if (!plan) return { status: 404, body: { ok: false, error: 'membership_plan_not_found' } };
  if (!plan.isActive) return { status: 409, body: { ok: false, error: 'membership_plan_inactive' } };
  if (!plan.isPublic) return { status: 409, body: { ok: false, error: 'membership_plan_not_public' } };
  if (plan.code === 'free') return { status: 400, body: { ok: false, error: 'free_plan_checkout_not_allowed' } };

  await Audit.create({
    actor: input.userId,
    action: paymentAuditActions.membershipCheckoutRequested,
  });

  const validation = validateStripeConfig(config);
  const stripeBlocked = !config.enabled || !validation.ok;
  const checkoutRequestId = `checkout_${randomUUID()}`;

  const session = await PaymentCheckoutSession.create({
    userId: toObjectId(input.userId),
    membershipPlanId: plan._id,
    provider: 'stripe',
    checkoutRequestId,
    mode: 'subscription',
    status: stripeBlocked ? 'failed' : 'created',
    amount: plan.price,
    currency: plan.currency,
    successUrl: config.successUrl,
    cancelUrl: config.cancelUrl,
    metadata: {
      membershipPlanCode: plan.code,
      userId: input.userId,
    },
  });

  if (!config.enabled) {
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

  return {
    status: 501,
    body: {
      ok: false,
      error: 'stripe_checkout_not_implemented',
      checkoutRequestId: session.checkoutRequestId,
    },
  };
}
