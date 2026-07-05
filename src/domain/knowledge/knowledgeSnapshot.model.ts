import { Schema, model, Types } from 'mongoose';

export interface IKnowledgeSnapshot {
  tenantId: string;
  packageId: Types.ObjectId;
  records: Types.ObjectId[];
  collections: Types.ObjectId[];
  assets: Types.ObjectId[];
  versions: Record<string, number>;
  generatedAt: Date;
  createdAt: Date;
}

const knowledgeSnapshotSchema = new Schema<IKnowledgeSnapshot>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'KnowledgeUtilizationPackage', required: true, index: true },
    records: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeRecord' }],
    collections: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeCollection' }],
    assets: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeAsset' }],
    versions: { type: Schema.Types.Mixed, required: true },
    generatedAt: { type: Date, required: true, index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

export const KnowledgeSnapshot = model<IKnowledgeSnapshot>('KnowledgeSnapshot', knowledgeSnapshotSchema);
