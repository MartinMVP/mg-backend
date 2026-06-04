import { MembershipPlan, MembershipBenefits } from './membershipPlan.model';

export const freeMembershipBenefits: MembershipBenefits = {
  maxActiveListings: 1,
  maxPhotosPerListing: 3,
  canUseFeaturedListings: false,
  includedFeaturedListings: 0,
  canAccessAuctions: false,
  canAccessMetrics: false,
  supportLevel: 'basic',
};

export const defaultMembershipPlans = [
  {
    name: 'Free',
    code: 'free',
    description: 'Membresía básica gratuita para comenzar en Enlace Ganadero.',
    price: 0,
    currency: 'MXN' as const,
    billingPeriod: 'manual' as const,
    benefits: freeMembershipBenefits,
    isActive: true,
    isPublic: true,
    sortOrder: 0,
  },
  {
    name: 'Pro',
    code: 'pro',
    description: 'Plan Pro preparado para beneficios avanzados futuros.',
    price: 0,
    currency: 'MXN' as const,
    billingPeriod: 'manual' as const,
    benefits: {
      ...freeMembershipBenefits,
      maxActiveListings: 10,
      maxPhotosPerListing: 8,
      canUseFeaturedListings: true,
      includedFeaturedListings: 2,
      canAccessAuctions: true,
      canAccessMetrics: true,
      supportLevel: 'priority' as const,
    },
    isActive: true,
    isPublic: false,
    sortOrder: 10,
  },
  {
    name: 'Business',
    code: 'business',
    description: 'Plan Business preparado para operaciones comerciales futuras.',
    price: 0,
    currency: 'MXN' as const,
    billingPeriod: 'manual' as const,
    benefits: {
      ...freeMembershipBenefits,
      maxActiveListings: 50,
      maxPhotosPerListing: 12,
      canUseFeaturedListings: true,
      includedFeaturedListings: 10,
      canAccessAuctions: true,
      canAccessMetrics: true,
      supportLevel: 'priority' as const,
    },
    isActive: true,
    isPublic: false,
    sortOrder: 20,
  },
];

export async function ensureDefaultMembershipPlans() {
  for (const plan of defaultMembershipPlans) {
    await MembershipPlan.findOneAndUpdate(
      { code: plan.code },
      { $setOnInsert: plan },
      { upsert: true, new: true, runValidators: true }
    );
  }

  return MembershipPlan.findOne({ code: 'free' });
}
