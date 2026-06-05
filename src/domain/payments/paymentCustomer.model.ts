import { Schema, model, Types } from 'mongoose';
import { StripeEnvironment } from './stripe.config';

export type PaymentProvider = 'stripe';
export type PaymentCustomerStatus = 'active' | 'inactive';

export interface IPaymentCustomer {
  userId: Types.ObjectId;
  provider: PaymentProvider;
  providerEnvironment: StripeEnvironment;
  providerCustomerId: string;
  email?: string;
  name?: string;
  status: PaymentCustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

const paymentCustomerSchema = new Schema<IPaymentCustomer>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['stripe'], default: 'stripe', required: true },
    providerEnvironment: { type: String, enum: ['sandbox', 'production'], required: true },
    providerCustomerId: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true },
    name: { type: String, trim: true },
    status: { type: String, enum: ['active', 'inactive'], default: 'active', required: true },
  },
  { timestamps: true }
);

paymentCustomerSchema.index({ userId: 1, provider: 1, providerEnvironment: 1 }, { unique: true });
paymentCustomerSchema.index(
  { provider: 1, providerEnvironment: 1, providerCustomerId: 1 },
  { unique: true }
);

export const PaymentCustomer = model<IPaymentCustomer>('PaymentCustomer', paymentCustomerSchema);
