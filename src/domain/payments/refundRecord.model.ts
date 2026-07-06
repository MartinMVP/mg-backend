import { Schema, model, Types } from 'mongoose';

export const refundRecordStatuses = ['requested', 'processed', 'rejected'] as const;
export type RefundRecordStatus = typeof refundRecordStatuses[number];

export interface IRefundRecord {
  operationId: Types.ObjectId;
  paymentTransactionId?: Types.ObjectId;
  amount: number;
  currency: string;
  status: RefundRecordStatus;
  reason?: string;
  providerRefundId?: string;
  requestedBy: Types.ObjectId;
  processedAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const refundRecordSchema = new Schema<IRefundRecord>(
  {
    operationId: { type: Schema.Types.ObjectId, ref: 'CommercialOperation', required: true, index: true },
    paymentTransactionId: { type: Schema.Types.ObjectId, ref: 'PaymentTransaction', index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true },
    status: { type: String, enum: refundRecordStatuses, required: true, default: 'requested', index: true },
    reason: { type: String, trim: true },
    providerRefundId: { type: String, trim: true, sparse: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    processedAt: Date,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const RefundRecord = model<IRefundRecord>('RefundRecord', refundRecordSchema);
