import { Schema, model, Types } from 'mongoose';

export const membershipBenefitFeatures = [
  'animal_listings',
  'auction_listings',
  'media_uploads',
  'messaging',
  'featured_publications',
] as const;

export type MembershipBenefitFeature = typeof membershipBenefitFeatures[number];

export interface IMembershipBenefit {
  planId: Types.ObjectId;
  membershipId?: Types.ObjectId;
  userId?: Types.ObjectId;
  feature: MembershipBenefitFeature;
  limit: number;
  consumed: number;
  isUnlimited: boolean;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const membershipBenefitSchema = new Schema<IMembershipBenefit>(
  {
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    feature: { type: String, enum: membershipBenefitFeatures, required: true, index: true },
    limit: { type: Number, required: true, min: 0 },
    consumed: { type: Number, default: 0, min: 0 },
    isUnlimited: { type: Boolean, default: false },
    expiresAt: Date,
  },
  { timestamps: true }
);

membershipBenefitSchema.index({ membershipId: 1, feature: 1 }, { unique: true, sparse: true });

export const MembershipBenefit = model<IMembershipBenefit>('MembershipBenefit', membershipBenefitSchema);
