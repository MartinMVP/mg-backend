import { Schema, model } from 'mongoose';

export type MembershipBillingPeriod = 'monthly' | 'annual' | 'manual';
export type MembershipSupportLevel = 'basic' | 'priority';

export type MembershipBenefits = {
  maxActiveListings: number;
  maxPhotosPerListing: number;
  canUseFeaturedListings: boolean;
  includedFeaturedListings: number;
  canAccessAuctions: boolean;
  canAccessMetrics: boolean;
  supportLevel: MembershipSupportLevel;
};

export interface IMembershipPlan {
  name: string;
  code: string;
  description?: string;
  monthlyPrice?: number;
  yearlyPrice?: number;
  durationDays?: number;
  price: number;
  currency: 'MXN';
  billingPeriod: MembershipBillingPeriod;
  benefits: MembershipBenefits;
  limits?: Record<string, number>;
  isActive: boolean;
  isPublic: boolean;
  trialDays?: number;
  stripePriceId?: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const benefitsSchema = new Schema<MembershipBenefits>(
  {
    maxActiveListings: { type: Number, required: true, min: 0 },
    maxPhotosPerListing: { type: Number, required: true, min: 0 },
    canUseFeaturedListings: { type: Boolean, required: true },
    includedFeaturedListings: { type: Number, required: true, min: 0 },
    canAccessAuctions: { type: Boolean, required: true },
    canAccessMetrics: { type: Boolean, required: true },
    supportLevel: { type: String, enum: ['basic', 'priority'], required: true },
  },
  { _id: false }
);

const membershipPlanSchema = new Schema<IMembershipPlan>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    monthlyPrice: { type: Number, min: 0 },
    yearlyPrice: { type: Number, min: 0 },
    durationDays: { type: Number, min: 1 },
    price: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN', required: true },
    billingPeriod: { type: String, enum: ['monthly', 'annual', 'manual'], required: true },
    benefits: { type: benefitsSchema, required: true },
    limits: { type: Schema.Types.Mixed },
    isActive: { type: Boolean, default: true, index: true },
    isPublic: { type: Boolean, default: true, index: true },
    trialDays: { type: Number, min: 0 },
    stripePriceId: { type: String, trim: true },
    sortOrder: { type: Number, default: 0, index: true },
  },
  { timestamps: true }
);

membershipPlanSchema.pre('validate', function () {
  if (this.code) this.code = this.code.toLowerCase().trim();
});

export const MembershipPlan = model<IMembershipPlan>('MembershipPlan', membershipPlanSchema);


