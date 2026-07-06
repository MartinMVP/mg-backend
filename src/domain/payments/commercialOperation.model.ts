import { Schema, model, Types } from 'mongoose';

export const commercialOperationTypes = [
  'membership',
  'featured_listing',
  'advertising',
  'sponsorship',
  'auction_fee',
  'service',
] as const;

export const commercialOperationStatuses = [
  'created',
  'checkout_pending',
  'payment_pending',
  'paid',
  'settled',
  'failed',
  'refunded',
  'cancelled',
] as const;

export type CommercialOperationType = typeof commercialOperationTypes[number];
export type CommercialOperationStatus = typeof commercialOperationStatuses[number];

export interface ICommercialOperation {
  operationNumber: string;
  operationType: CommercialOperationType;
  referenceType: string;
  referenceId: string;
  amount: number;
  currency: string;
  status: CommercialOperationStatus;
  metadata?: Record<string, unknown>;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const commercialOperationSchema = new Schema<ICommercialOperation>(
  {
    operationNumber: { type: String, required: true, unique: true, index: true, trim: true },
    operationType: { type: String, enum: commercialOperationTypes, required: true, index: true },
    referenceType: { type: String, required: true, trim: true, index: true },
    referenceId: { type: String, required: true, trim: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, uppercase: true, trim: true, default: 'MXN' },
    status: { type: String, enum: commercialOperationStatuses, required: true, default: 'created', index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  },
  { timestamps: true }
);

commercialOperationSchema.index({ operationType: 1, referenceType: 1, referenceId: 1 });

export const CommercialOperation = model<ICommercialOperation>('CommercialOperation', commercialOperationSchema);
