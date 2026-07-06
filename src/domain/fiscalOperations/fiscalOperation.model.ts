import { Schema, model, Types } from 'mongoose';

export const fiscalOperationStatuses = [
  'created',
  'pending_stamp',
  'stamped',
  'delivery_pending',
  'delivered',
  'cancellation_requested',
  'cancelled',
  'failed',
] as const;

export type FiscalOperationStatus = typeof fiscalOperationStatuses[number];

export interface IFiscalOperation {
  operationId: Types.ObjectId;
  commercialOperationId: Types.ObjectId;
  invoiceStatus: FiscalOperationStatus;
  provider: string;
  providerReference?: string;
  uuid?: string;
  xmlLocation?: string;
  pdfLocation?: string;
  amount?: number;
  currency?: string;
  providerMessage?: string;
  lastError?: string;
  transientError?: boolean;
  cancellationRequestedBy?: Types.ObjectId;
  cancellationRequestedAt?: Date;
  cancellationReason?: string;
  cancelledAt?: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const fiscalOperationSchema = new Schema<IFiscalOperation>(
  {
    operationId: { type: Schema.Types.ObjectId, ref: 'PaymentSettlement', required: true, index: true },
    commercialOperationId: { type: Schema.Types.ObjectId, ref: 'CommercialOperation', required: true, unique: true, index: true },
    invoiceStatus: { type: String, enum: fiscalOperationStatuses, required: true, default: 'created', index: true },
    provider: { type: String, required: true, trim: true, default: 'mock', index: true },
    providerReference: { type: String, trim: true, index: true },
    uuid: { type: String, trim: true, index: true },
    xmlLocation: { type: String, trim: true },
    pdfLocation: { type: String, trim: true },
    amount: { type: Number, min: 0 },
    currency: { type: String, uppercase: true, trim: true },
    providerMessage: { type: String, trim: true },
    lastError: { type: String, trim: true },
    transientError: { type: Boolean, default: false, index: true },
    cancellationRequestedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    cancellationRequestedAt: Date,
    cancellationReason: { type: String, trim: true },
    cancelledAt: Date,
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

fiscalOperationSchema.index({ invoiceStatus: 1, updatedAt: -1 });

export const FiscalOperation = model<IFiscalOperation>('FiscalOperation', fiscalOperationSchema);
