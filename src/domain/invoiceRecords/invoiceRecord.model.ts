import { Schema, model, Types } from 'mongoose';

export type InvoiceRecordStatus =
  | 'created'
  | 'processing'
  | 'completed'
  | 'failed';

export interface IInvoiceRecord {
  transactionId: Types.ObjectId;
  invoiceDraftId: Types.ObjectId;
  invoiceQueueId: Types.ObjectId;
  status: InvoiceRecordStatus;
  attempts: number;
  lastError?: string;
  processedAt?: Date;
}

const InvoiceRecordSchema = new Schema<IInvoiceRecord>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true, index: true },
    invoiceDraftId: { type: Schema.Types.ObjectId, ref: 'InvoiceDraft', required: true, index: true },
    invoiceQueueId: {
      type: Schema.Types.ObjectId,
      ref: 'InvoiceQueue',
      required: true,
      unique: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['created', 'processing', 'completed', 'failed'],
      default: 'created',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    lastError: { type: String, trim: true },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

export const InvoiceRecord = model<IInvoiceRecord>('InvoiceRecord', InvoiceRecordSchema);
