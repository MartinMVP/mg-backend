import { Schema, model } from 'mongoose';
import { PaymentProvider } from './paymentCustomer.model';

export interface IPaymentWebhookLog {
  provider: PaymentProvider;
  providerEventId: string;
  eventType: string;
  payloadHash: string;
  processed: boolean;
  processedAt?: Date;
  attempts: number;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const paymentWebhookLogSchema = new Schema<IPaymentWebhookLog>(
  {
    provider: { type: String, enum: ['stripe'], default: 'stripe', required: true },
    providerEventId: { type: String, required: true, unique: true, trim: true },
    eventType: { type: String, required: true, trim: true },
    payloadHash: { type: String, required: true, trim: true },
    processed: { type: Boolean, default: false, required: true },
    processedAt: Date,
    attempts: { type: Number, default: 0, min: 0, required: true },
    lastError: { type: String, trim: true },
  },
  { timestamps: true }
);

export const PaymentWebhookLog = model<IPaymentWebhookLog>('PaymentWebhookLog', paymentWebhookLogSchema);
