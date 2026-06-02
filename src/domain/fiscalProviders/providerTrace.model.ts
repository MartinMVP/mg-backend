import { Schema, model, Types } from 'mongoose';

export type ProviderTraceOperation = 'validate' | 'issue' | 'cancel' | 'status';
export type ProviderTraceStatus = 'pending' | 'success' | 'failed';

export interface IProviderTrace {
  invoiceRecordId?: Types.ObjectId;
  invoiceQueueId?: Types.ObjectId;
  transactionId?: Types.ObjectId;
  providerName: string;
  providerEnvironment?: string;
  operation: ProviderTraceOperation;
  status: ProviderTraceStatus;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string;
  durationMs?: number;
  attempt?: number;
  startedAt: Date;
  completedAt?: Date;
}

const ProviderTraceSchema = new Schema<IProviderTrace>(
  {
    invoiceRecordId: { type: Schema.Types.ObjectId, ref: 'InvoiceRecord', index: true },
    invoiceQueueId: { type: Schema.Types.ObjectId, ref: 'InvoiceQueue', index: true },
    transactionId: { type: Schema.Types.ObjectId, ref: 'Transaction', index: true },
    providerName: { type: String, required: true, trim: true, index: true },
    providerEnvironment: { type: String, trim: true },
    operation: {
      type: String,
      enum: ['validate', 'issue', 'cancel', 'status'],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ['pending', 'success', 'failed'],
      default: 'pending',
      index: true,
    },
    requestPayload: { type: Schema.Types.Mixed },
    responsePayload: { type: Schema.Types.Mixed },
    errorMessage: { type: String, trim: true },
    durationMs: { type: Number, min: 0 },
    attempt: { type: Number, min: 0 },
    startedAt: { type: Date, required: true, default: Date.now, index: true },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

export const ProviderTrace = model<IProviderTrace>('ProviderTrace', ProviderTraceSchema);
