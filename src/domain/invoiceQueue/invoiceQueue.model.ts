import { Schema, model, Types } from 'mongoose';

export type InvoiceQueueStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'cancelled';

export interface IInvoiceQueue {
  transactionId: Types.ObjectId;
  invoiceDraftId: Types.ObjectId;
  fiscalSnapshotId: Types.ObjectId;
  status: InvoiceQueueStatus;
  queuedAt: Date;
  processedAt?: Date;
}

const InvoiceQueueSchema = new Schema<IInvoiceQueue>(
  {
    transactionId: {
      type: Schema.Types.ObjectId,
      ref: 'Transaction',
      required: true,
    },
    invoiceDraftId: {
      type: Schema.Types.ObjectId,
      ref: 'InvoiceDraft',
      required: true,
      index: true,
    },
    fiscalSnapshotId: {
      type: Schema.Types.ObjectId,
      ref: 'FiscalSnapshot',
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'cancelled'],
      default: 'queued',
      index: true,
    },
    queuedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

InvoiceQueueSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['queued', 'processing'] } },
  }
);

export const InvoiceQueue = model<IInvoiceQueue>('InvoiceQueue', InvoiceQueueSchema);
