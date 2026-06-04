import { Schema, model, Types } from 'mongoose';

export interface IMembershipUsage {
  userId: Types.ObjectId;
  membershipId: Types.ObjectId;
  planId: Types.ObjectId;
  activeListingsCount: number;
  listingsCreatedThisPeriod: number;
  featuredListingsUsed: number;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  updatedAt: Date;
}

const membershipUsageSchema = new Schema<IMembershipUsage>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true },
    activeListingsCount: { type: Number, default: 0, min: 0 },
    listingsCreatedThisPeriod: { type: Number, default: 0, min: 0 },
    featuredListingsUsed: { type: Number, default: 0, min: 0 },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
  },
  { timestamps: true }
);

membershipUsageSchema.index({ userId: 1, periodStart: 1, periodEnd: 1 });
membershipUsageSchema.index({ membershipId: 1, periodStart: 1, periodEnd: 1 }, { unique: true });

export const MembershipUsage = model<IMembershipUsage>('MembershipUsage', membershipUsageSchema);
