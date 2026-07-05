import { Schema, model, Types } from 'mongoose';
import { OutcomeType, outcomeTypes } from './knowledgeValidation.types';

export interface IOutcomeRegistry {
  tenantId: string;
  outcomeType: OutcomeType;
  sourceDomain: string;
  sourceId?: Types.ObjectId | string | null;
  businessOutcome: string;
  operationalOutcome: string;
  knowledgeOutcome: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const outcomeRegistrySchema = new Schema<IOutcomeRegistry>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    outcomeType: { type: String, enum: outcomeTypes, required: true, index: true },
    sourceDomain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    sourceId: { type: Schema.Types.Mixed, default: null, index: true },
    businessOutcome: { type: String, required: true, trim: true, maxlength: 1000 },
    operationalOutcome: { type: String, required: true, trim: true, maxlength: 1000 },
    knowledgeOutcome: { type: String, required: true, trim: true, maxlength: 1000 },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

outcomeRegistrySchema.index({ sourceDomain: 1, createdAt: -1 });

export const OutcomeRegistry = model<IOutcomeRegistry>('OutcomeRegistry', outcomeRegistrySchema);
