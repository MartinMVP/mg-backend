import { Schema, model, Types } from 'mongoose';

export interface IKnowledgeValidationSnapshot {
  tenantId: string;
  validationId: Types.ObjectId;
  knowledgeSnapshot: Record<string, unknown>;
  outcomeSnapshot: Record<string, unknown>;
  validationSnapshot: Record<string, unknown>;
  ruleSnapshot: Record<string, unknown>;
  createdAt: Date;
}

const knowledgeValidationSnapshotSchema = new Schema<IKnowledgeValidationSnapshot>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    validationId: { type: Schema.Types.ObjectId, ref: 'KnowledgeValidation', required: true, index: true },
    knowledgeSnapshot: { type: Schema.Types.Mixed, required: true },
    outcomeSnapshot: { type: Schema.Types.Mixed, required: true },
    validationSnapshot: { type: Schema.Types.Mixed, required: true },
    ruleSnapshot: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const KnowledgeValidationSnapshot = model<IKnowledgeValidationSnapshot>(
  'KnowledgeValidationSnapshot',
  knowledgeValidationSnapshotSchema
);
