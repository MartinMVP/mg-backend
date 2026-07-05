import { Schema, model, Types } from 'mongoose';

export interface IKnowledgeValidationHistory {
  tenantId: string;
  assetId: Types.ObjectId;
  validations: Types.ObjectId[];
  trends: Record<string, unknown>;
  createdAt: Date;
}

const knowledgeValidationHistorySchema = new Schema<IKnowledgeValidationHistory>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'KnowledgeAsset', required: true, index: true },
    validations: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeValidation' }],
    trends: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const KnowledgeValidationHistory = model<IKnowledgeValidationHistory>(
  'KnowledgeValidationHistory',
  knowledgeValidationHistorySchema
);
