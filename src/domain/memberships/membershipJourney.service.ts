import { Types } from 'mongoose';
import { MembershipPlan, IMembershipPlan } from './membershipPlan.model';
import { getMembershipCapacity } from './membershipCatalogPolicy';
import { UserMembership } from './userMembership.model';
import { PaymentRecord } from '../payments/paymentRecord.model';
import { Listing } from '../listings/listing.model';

/** Public commercial projection: benefits remain owned by MembershipPlan. */
export function journeyPlan(plan: IMembershipPlan & { _id: Types.ObjectId }) {
  return {
    _id: String(plan._id), code: plan.code, name: plan.name, description: plan.description,
    price: plan.price, currency: plan.currency, billingPeriod: plan.billingPeriod,
    durationDays: plan.durationDays, benefits: plan.benefits,
  };
}

/** The existing payment validator rejects production; never advertise sandbox as a sale. */
export function journeyCommercialCapabilities() {
  return {
    paidCheckout: false,
    paidCheckoutReason: 'La contratación de planes de pago todavía no está disponible. Puedes comparar planes y utilizar tu membresía actual.',
    taxes: null,
    taxNotice: 'El catálogo no proporciona un desglose de impuestos ni un total de contratación.',
    automaticRenewal: false,
    renewalNotice: 'No hay renovación automática productiva habilitada. Una fecha de fin de periodo no confirma un próximo cargo.',
    cancellationNotice: 'La cancelación se programa para el final del periodo vigente. Puedes retirar la solicitud antes de que se aplique.',
    changeNotice: 'Los cambios a un plan de menor precio se programan al final del periodo; las mejoras de pago requieren contratación disponible.',
    featuredPublishing: false,
    featuredNotice: 'La aplicación y medición del beneficio destacado aún no están integradas al flujo de publicación.',
    supportContact: null,
  };
}

export async function getJourneyPlans() {
  const plans = await MembershipPlan.find({ isActive: true, isPublic: true }).sort({ sortOrder: 1, createdAt: 1 });
  return { items: plans.map(journeyPlan), capabilities: journeyCommercialCapabilities() };
}

/** One server-owned snapshot avoids frontend interpretations of membership status/capacity. */
export async function getMembershipJourney(userId: string) {
  const capacity = await getMembershipCapacity(userId);
  const { membership, plan, usage } = capacity;
  const [pending, publications, payments] = await Promise.all([
    UserMembership.findOne({ userId, status: { $in: ['draft', 'pending_activation', 'pending_payment', 'payment_failed'] }, _id: { $ne: membership._id } })
      .sort({ createdAt: -1 }).select('_id planId status').lean(),
    Listing.find({ seller: userId }).sort({ createdAt: -1 }).limit(20)
      .select('_id title status publishedAt createdAt animal price currency').lean(),
    PaymentRecord.find({ userId, type: 'membership' }).sort({ createdAt: -1 }).limit(20)
      .select('_id status amount currency paidAt createdAt providerEnvironment').lean(),
  ]);
  return {
    membership: {
      _id: String(membership._id), status: membership.status, planId: String(membership.planId),
      currentPeriodStart: membership.currentPeriodStart, currentPeriodEnd: membership.currentPeriodEnd,
      activatedAt: membership.activatedAt, renewalMode: membership.renewalMode,
      cancelAtPeriodEnd: Boolean(membership.cancelAtPeriodEnd),
      pendingChangeType: membership.pendingChangeType, pendingChangeEffectiveAt: membership.pendingChangeEffectiveAt,
    },
    plan: plan ? journeyPlan(plan) : null,
    capacity: {
      activeListings: capacity.activeListings, maxActiveListings: capacity.maxActiveListings,
      remaining: capacity.grantsBenefits ? capacity.remaining : 0, grantsBenefits: capacity.grantsBenefits,
    },
    usage: { listingsCreatedThisPeriod: usage?.listingsCreatedThisPeriod ?? 0, featuredListingsUsed: usage?.featuredListingsUsed ?? 0 },
    actions: {
      publish: capacity.grantsBenefits && capacity.remaining > 0,
      cancel: capacity.grantsBenefits && !membership.cancelAtPeriodEnd,
      withdrawCancellation: capacity.grantsBenefits && Boolean(membership.cancelAtPeriodEnd),
      changePlan: capacity.grantsBenefits,
    },
    pendingMembership: pending, publications, payments,
    capabilities: journeyCommercialCapabilities(),
  };
}
