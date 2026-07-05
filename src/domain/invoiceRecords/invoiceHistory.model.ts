import { Schema, model, Types } from 'mongoose';

export interface IInvoiceHistory {
  invoiceId: Types.ObjectId;
  transactionId?: Types.ObjectId;
  membershipId?: Types.ObjectId;
  userId?: Types.ObjectId;
  event: string;
  metadata?: Record<string, unknown>;
  timestamp: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InvoiceHistorySchema = new Schema<IInvoiceHistory>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'InvoiceRecord', required: true, index: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    event: { type: String, required: true, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, required: true, default: Date.now, index: true },
  },
  { timestamps: true }
);

InvoiceHistorySchema.index({ userId: 1, timestamp: -1 });
InvoiceHistorySchema.index({ invoiceId: 1, timestamp: -1 });

export const InvoiceHistory = model<IInvoiceHistory>('InvoiceHistory', InvoiceHistorySchema);
