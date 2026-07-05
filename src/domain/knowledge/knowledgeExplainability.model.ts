import { Schema, model, Types } from 'mongoose';

export interface IKnowledgeExplainability {
  selectedAssets: Types.ObjectId[];
  discardedAssets: Types.ObjectId[];
  appliedPolicies: Record<string, unknown>[];
  excludedByRules: Array<{ assetId?: Types.ObjectId | string | null; reason: string }>;
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeExplainabilitySchema = new Schema<IKnowledgeExplainability>(
  {
    selectedAssets: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeAsset' }],
    discardedAssets: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeAsset' }],
    appliedPolicies: { type: [Schema.Types.Mixed] as any, default: [] },
    excludedByRules: { type: [Schema.Types.Mixed] as any, default: [] },
  },
  { timestamps: true }
);

export const KnowledgeExplainability = model<IKnowledgeExplainability>(
  'KnowledgeExplainability',
  knowledgeExplainabilitySchema
);
