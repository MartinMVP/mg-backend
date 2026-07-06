import { Schema, model, Types } from 'mongoose';

export const paymentTransactionStatuses = [
  'intent_created',
  'checkout_created',
  'payment_pending',
  'settled',
  'failed',
  'refunded',
] as const;

export type PaymentTransactionStatus = typeof paymentTransactionStatuses[number];

export interface IPaymentTransaction {
  operationId: Types.ObjectId;
  operationNumber: string;
  provider: string;
  providerPaymentIntentId: string;
  providerCheckoutId?: string;
  providerEventId?: string;
  amount: number;
  currency: string;
  status: PaymentTransactionStatus;
  checkoutUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const paymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    operationId: { type: Schema.Types.ObjectId, ref: 'CommercialOperation', required: true, index: true },
    operationNumber: { type: String, required: true, index: true, trim: true },
    provider: { type: String, required: true, default: 'internal', trim: true, index: true },
    providerPaymentIntentId: { type: String, required: true, unique: true, trim: true },
    providerCheckoutId: { type: String, trim: true, sparse: true, index: true },
    providerEventId: { type: String, trim: true, sparse: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, enum: paymentTransactionStatuses, required: true, default: 'intent_created', index: true },
    checkoutUrl: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const PaymentTransaction = model<IPaymentTransaction>('PaymentTransaction', paymentTransactionSchema);
