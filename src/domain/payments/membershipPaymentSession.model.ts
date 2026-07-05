import { Schema, model, Types } from 'mongoose';

export const membershipPaymentSessionStatuses = [
  'checkout_created',
  'payment_pending',
  'payment_confirmed',
  'payment_failed',
  'payment_cancelled',
  'checkout_expired',
] as const;

export type MembershipPaymentSessionStatus = typeof membershipPaymentSessionStatuses[number];

export interface IMembershipPaymentSession {
  userId: Types.ObjectId;
  planId: Types.ObjectId;
  membershipId?: Types.ObjectId;
  stripeCheckoutSessionId: string;
  checkoutRequestId: string;
  status: MembershipPaymentSessionStatus;
  amount: number;
  currency: 'MXN';
  checkoutUrl?: string;
  createdAt: Date;
  expiresAt?: Date;
  completedAt?: Date;
  metadata?: Record<string, unknown>;
  updatedAt: Date;
}

const membershipPaymentSessionSchema = new Schema<IMembershipPaymentSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    planId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership' },
    stripeCheckoutSessionId: { type: String, required: true, unique: true, trim: true },
    checkoutRequestId: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: membershipPaymentSessionStatuses, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN', required: true },
    checkoutUrl: { type: String, trim: true },
    expiresAt: Date,
    completedAt: Date,
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

membershipPaymentSessionSchema.index({ userId: 1, status: 1 });
membershipPaymentSessionSchema.index({ membershipId: 1 });

export const MembershipPaymentSession = model<IMembershipPaymentSession>(
  'MembershipPaymentSession',
  membershipPaymentSessionSchema
);

