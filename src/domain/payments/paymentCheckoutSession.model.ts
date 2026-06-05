import { Schema, model, Types } from 'mongoose';
import { PaymentProvider } from './paymentCustomer.model';
import { StripeEnvironment } from './stripe.config';

export type PaymentCheckoutMode = 'subscription';
export type PaymentCheckoutStatus = 'created' | 'open' | 'completed' | 'expired' | 'failed';

export interface IPaymentCheckoutSession {
  userId: Types.ObjectId;
  membershipPlanId: Types.ObjectId;
  provider: PaymentProvider;
  providerEnvironment: StripeEnvironment;
  providerSessionId?: string;
  providerCustomerId?: string;
  checkoutRequestId: string;
  mode: PaymentCheckoutMode;
  status: PaymentCheckoutStatus;
  amount: number;
  currency: 'MXN';
  successUrl?: string;
  cancelUrl?: string;
  checkoutUrl?: string;
  expiresAt?: Date;
  metadata?: {
    checkoutRequestId?: string;
    membershipPlanCode?: string;
    membershipPlanId?: string;
    userId?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const paymentCheckoutSessionSchema = new Schema<IPaymentCheckoutSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    membershipPlanId: { type: Schema.Types.ObjectId, ref: 'MembershipPlan', required: true, index: true },
    provider: { type: String, enum: ['stripe'], default: 'stripe', required: true },
    providerEnvironment: { type: String, enum: ['sandbox', 'production'], default: 'sandbox', required: true },
    providerSessionId: { type: String, trim: true, index: true },
    providerCustomerId: { type: String, trim: true },
    checkoutRequestId: { type: String, required: true, unique: true, trim: true },
    mode: { type: String, enum: ['subscription'], default: 'subscription', required: true },
    status: { type: String, enum: ['created', 'open', 'completed', 'expired', 'failed'], required: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, enum: ['MXN'], default: 'MXN', required: true },
    successUrl: { type: String, trim: true },
    cancelUrl: { type: String, trim: true },
    checkoutUrl: { type: String, trim: true },
    expiresAt: Date,
    metadata: {
      checkoutRequestId: { type: String, trim: true },
      membershipPlanCode: { type: String, trim: true },
      membershipPlanId: { type: String, trim: true },
      userId: { type: String, trim: true },
    },
  },
  { timestamps: true }
);

paymentCheckoutSessionSchema.index({ userId: 1, status: 1 });
paymentCheckoutSessionSchema.index({ userId: 1, membershipPlanId: 1, status: 1, expiresAt: 1 });

export const PaymentCheckoutSession = model<IPaymentCheckoutSession>(
  'PaymentCheckoutSession',
  paymentCheckoutSessionSchema
);
