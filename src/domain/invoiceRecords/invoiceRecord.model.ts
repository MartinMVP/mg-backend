import { Schema, model, Types } from 'mongoose';

export type InvoiceRecordStatus =
  | 'created'
  | 'processing'
  | 'completed'
  | 'failed'
  | 'pending'
  | 'issued'
  | 'cancel_requested'
  | 'cancel_processing'
  | 'cancelled'
  | 'cancel_failed';

export type InvoiceRecordLifecycleStatus =
  | 'pending'
  | 'issuing'
  | 'issued'
  | 'cancelling'
  | 'cancel_requested'
  | 'cancel_processing'
  | 'cancelled'
  | 'failed'
  | 'cancel_failed';

export interface IInvoiceRecord {
  transactionId: Types.ObjectId;
  invoiceDraftId?: Types.ObjectId;
  invoiceQueueId?: Types.ObjectId;
  membershipId?: Types.ObjectId;
  userId?: Types.ObjectId;
  invoiceUUID?: string;
  status: InvoiceRecordStatus;
  attempts: number;
  retryCount?: number;
  lastError?: string;
  amount?: number;
  currency?: string;
  xmlUrl?: string;
  pdfUrl?: string;
  processedAt?: Date;
  issuedAt?: Date;
  cancelledAt?: Date;
  cancellationReason?: string;
  lifecycleStatus?: InvoiceRecordLifecycleStatus;
  provider?: string;
  providerEnvironment?: string;
  providerReference?: string;
  providerRequestId?: string;
  providerName?: string;
  providerStatus?: string;
  providerMessage?: string;
  simulatedExternalId?: string;
  receiver?: Record<string, unknown>;
  fiscalTrace?: Record<string, unknown>;
}

const InvoiceRecordSchema = new Schema<IInvoiceRecord>(
  {
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', required: true },
    invoiceDraftId: { type: Schema.Types.ObjectId, ref: 'InvoiceDraft', index: true },
    invoiceQueueId: {
      type: Schema.Types.ObjectId,
      ref: 'InvoiceQueue',
      unique: true,
      sparse: true,
      index: true,
    },
    membershipId: { type: Schema.Types.ObjectId, ref: 'UserMembership', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    invoiceUUID: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ['created', 'processing', 'completed', 'failed', 'pending', 'issued', 'cancel_requested', 'cancel_processing', 'cancelled', 'cancel_failed'],
      default: 'created',
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    retryCount: { type: Number, default: 0, min: 0 },
    lastError: { type: String, trim: true },
    amount: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true },
    xmlUrl: { type: String, trim: true },
    pdfUrl: { type: String, trim: true },
    processedAt: { type: Date },
    issuedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true },
    lifecycleStatus: {
      type: String,
      enum: ['pending', 'issuing', 'issued', 'cancelling', 'cancel_requested', 'cancel_processing', 'cancelled', 'failed', 'cancel_failed'],
      default: 'pending',
      index: true,
    },
    provider: { type: String, trim: true },
    providerEnvironment: { type: String, trim: true },
    providerReference: { type: String, trim: true },
    providerRequestId: { type: String, trim: true },
    providerName: { type: String, trim: true },
    providerStatus: { type: String, trim: true },
    providerMessage: { type: String, trim: true },
    simulatedExternalId: { type: String, trim: true },
    receiver: { type: Schema.Types.Mixed },
    fiscalTrace: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

InvoiceRecordSchema.index(
  { transactionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      membershipId: { $exists: true },
      status: { $in: ['pending', 'processing', 'issued', 'cancel_requested', 'cancel_processing', 'failed', 'cancel_failed'] },
    },
  }
);
InvoiceRecordSchema.index({ userId: 1, createdAt: -1 });
InvoiceRecordSchema.index({ membershipId: 1, createdAt: -1 });

export const InvoiceRecord = model<IInvoiceRecord>('InvoiceRecord', InvoiceRecordSchema);

