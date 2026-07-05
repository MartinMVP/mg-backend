import { Schema, model, Types } from 'mongoose';

export const membershipPaymentTransactionStatuses = [
  'payment_confirmed',
  'payment_failed',
  'payment_cancelled',
] as const;

export type MembershipPaymentTransactionStatus = typeof membershipPaymentTransactionStatuses[number];

export interface IMembershipPaymentTransaction {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  membershipId: Types.ObjectId;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId?: string;
  stripeEventId: string;
  status: MembershipPaymentTransactionStatus;
  amount: number;
  currency: 'MXN';
  processedAt: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const membershipPaymentTransactionSchema = new Schema<IMembershipPaymentTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', required: true, index: true },
    stripeCheckoutSessionId: { type: String, required: true, trim: true, index: true },
    stripePaymentIntentId: { type: String, trim: true, index: true },
    stripeEventId: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: membershipPaymentTransactionStatuses, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN', required: true },
    processedAt: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

membershipPaymentTransactionSchema.index({ userId: 1, processedAt: -1 });

export const MembershipPaymentTransaction = model<IMembershipPaymentTransaction>(
  'MembershipPaymentTransaction',
  membershipPaymentTransactionSchema
);
