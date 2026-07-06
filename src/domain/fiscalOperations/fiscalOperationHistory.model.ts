import { Schema, model, Types } from 'mongoose';
import { FiscalOperationStatus } from './fiscalOperation.model';

export interface IFiscalOperationHistory {
  fiscalOperationId: Types.ObjectId;
  commercialOperationId: Types.ObjectId;
  event: string;
  fromStatus?: FiscalOperationStatus;
  toStatus: FiscalOperationStatus;
  actor: string;
  provider?: string;
  uuid?: string;
  xmlLocation?: string;
  pdfLocation?: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const fiscalOperationHistorySchema = new Schema<IFiscalOperationHistory>(
  {
    fiscalOperationId: { type: Schema.Types.ObjectId, ref: 'FiscalOperation', required: true, index: true },
    commercialOperationId: { type: Schema.Types.ObjectId, ref: 'CommercialOperation', required: true, index: true },
    event: { type: String, required: true, trim: true, index: true },
    fromStatus: { type: String, trim: true },
    toStatus: { type: String, required: true, trim: true, index: true },
    actor: { type: String, required: true, trim: true },
    provider: { type: String, trim: true },
    uuid: { type: String, trim: true },
    xmlLocation: { type: String, trim: true },
    pdfLocation: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

fiscalOperationHistorySchema.index({ commercialOperationId: 1, createdAt: 1 });

export const FiscalOperationHistory = model<IFiscalOperationHistory>('FiscalOperationHistory', fiscalOperationHistorySchema);
