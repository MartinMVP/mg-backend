import { Schema, model, Types } from 'mongoose';
import {
  KnowledgeDomain,
  KnowledgeLocation,
  KnowledgeLifecycle,
  KnowledgeQuality,
  KnowledgeRegistryStatus,
  KnowledgeStorageType,
  knowledgeDomains,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
  knowledgeRegistryStatuses,
  knowledgeStorageTypes,
} from './knowledge.types';

export interface IKnowledgeRegistry {
  knowledgeRecordId?: Types.ObjectId | null;
  collectionId?: Types.ObjectId | null;
  assetId?: Types.ObjectId | null;
  knowledgeDomain: KnowledgeDomain;
  knowledgeType: string;
  version: number;
  producer: string;
  location: KnowledgeLocation;
  quality?: KnowledgeQuality;
  lifecycle?: KnowledgeLifecycle;
  status: KnowledgeRegistryStatus;
  createdAt: Date;
}

const knowledgeLocationSchema = new Schema<KnowledgeLocation>(
  {
    storageType: { type: String, enum: knowledgeStorageTypes, required: true },
    reference: { type: String, required: true, trim: true, maxlength: 1000 },
  },
  { _id: false }
);

const knowledgeRegistrySchema = new Schema<IKnowledgeRegistry>(
  {
    knowledgeRecordId: { type: Schema.Types.ObjectId, ref: 'KnowledgeRecord', default: null },
    collectionId: { type: Schema.Types.ObjectId, ref: 'KnowledgeCollection', default: null, index: true },
    assetId: { type: Schema.Types.ObjectId, ref: 'KnowledgeAsset', default: null, index: true },
    knowledgeDomain: { type: String, enum: knowledgeDomains, required: true, index: true },
    knowledgeType: { type: String, required: true, trim: true, maxlength: 200, index: true },
    version: { type: Number, required: true, min: 1, index: true },
    producer: { type: String, required: true, trim: true, maxlength: 200, index: true },
    location: { type: knowledgeLocationSchema, required: true },
    quality: {
      level: { type: String, enum: knowledgeQualityLevels },
      score: { type: Number, min: 0, max: 100 },
      rationale: { type: String, trim: true, maxlength: 1000 },
      evaluatedAt: { type: Date },
    },
    lifecycle: {
      stage: { type: String, enum: knowledgeLifecycleStages },
      enteredAt: { type: Date },
      updatedAt: { type: Date },
      reason: { type: String, trim: true, maxlength: 1000, default: null },
    },
    status: { type: String, enum: knowledgeRegistryStatuses, default: 'active', index: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

knowledgeRegistrySchema.index({ knowledgeDomain: 1, knowledgeType: 1, version: -1 });
knowledgeRegistrySchema.index({ createdAt: -1 });
knowledgeRegistrySchema.index(
  { knowledgeRecordId: 1 },
  { unique: true, partialFilterExpression: { knowledgeRecordId: { $type: 'objectId' } } }
);

export const KnowledgeRegistry = model<IKnowledgeRegistry>('KnowledgeRegistry', knowledgeRegistrySchema);
