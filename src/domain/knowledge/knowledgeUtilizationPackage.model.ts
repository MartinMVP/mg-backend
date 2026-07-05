import { Schema, model, Types } from 'mongoose';

export interface IKnowledgeUtilizationPackage {
  tenantId: string;
  context: Record<string, unknown>;
  records: Types.ObjectId[];
  collections: Types.ObjectId[];
  assets: Types.ObjectId[];
  provenance: Record<string, unknown>;
  quality: Record<string, unknown>;
  explainability: Record<string, unknown>;
  generatedAt: Date;
  createdAt: Date;
}

const knowledgeUtilizationPackageSchema = new Schema<IKnowledgeUtilizationPackage>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    context: { type: Schema.Types.Mixed, required: true },
    records: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRecord' }],
    collections: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeCollection' }],
    assets: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeAsset' }],
    provenance: { type: Schema.Types.Mixed, required: true },
    quality: { type: Schema.Types.Mixed, required: true },
    explainability: { type: Schema.Types.Mixed, required: true },
    generatedAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

knowledgeUtilizationPackageSchema.index({ createdAt: -1 });

export const KnowledgeUtilizationPackage = model<IKnowledgeUtilizationPackage>(
  'KnowledgeUtilizationPackage',
  knowledgeUtilizationPackageSchema
);
