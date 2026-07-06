import { Schema, model } from 'mongoose';

export interface IReconciliationRecord {
  provider: string;
  status: 'completed';
  differences: number;
  missingPayments: number;
  duplicatePayments: number;
  pendingPayments: number;
  providerErrors: number;
  metadata?: Record<string, unknown>;
  executedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const reconciliationRecordSchema = new Schema<IReconciliationRecord>(
  {
    provider: { type: String, required: true, default: 'internal', trim: true, index: true },
    status: { type: String, enum: ['completed'], required: true, default: 'completed', index: true },
    differences: { type: Number, required: true, default: 0, min: 0 },
    missingPayments: { type: Number, required: true, default: 0, min: 0 },
    duplicatePayments: { type: Number, required: true, default: 0, min: 0 },
    pendingPayments: { type: Number, required: true, default: 0, min: 0 },
    providerErrors: { type: Number, required: true, default: 0, min: 0 },
    metadata: { type: Schema.Types.Mixed, default: {} },
    executedAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export const ReconciliationRecord = model<IReconciliationRecord>('ReconciliationRecord', reconciliationRecordSchema);
