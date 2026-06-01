import { Schema, model, Types } from 'mongoose';

export type InvoiceRecordStatus =
  | 'created'
  | 'processing'
  | 'completed'
  | 'failed';

export type InvoiceRecordLifecycleStatus =
  | 'pending'
  | 'issuing'
  | 'issued'
  | 'cancelling'
  | 'cancelled';

export interface IInvoiceRecord {
  transactionId: Types.ObjectId;
  invoiceDraftId: Types.ObjectId;
  invoiceQueueId: Types.ObjectId;
  status: InvoiceRecordStatus;
  attempts: number;
  lastError?: string;
  processedAt?: Date;
  issuedAt?: Date;
  cancelledAt?: Date;
  lifecycleStatus?: InvoiceRecordLifecycleStatus;
  providerName?: string;
  providerStatus?: string;
  providerMessage?: string;
  simulatedExternalId?: string;
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
    issuedAt: { type: Date },
    cancelledAt: { type: Date },
    lifecycleStatus: {
      type: String,
      enum: ['pending', 'issuing', 'issued', 'cancelling', 'cancelled'],
      default: 'pending',
      index: true,
    },
    providerName: { type: String, trim: true },
    providerStatus: { type: String, trim: true },
    providerMessage: { type: String, trim: true },
    simulatedExternalId: { type: String, trim: true },
  },
  { timestamps: true }
);

export const InvoiceRecord = model<IInvoiceRecord>('InvoiceRecord', InvoiceRecordSchema);
