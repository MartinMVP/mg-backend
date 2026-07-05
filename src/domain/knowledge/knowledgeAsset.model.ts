import { Schema, model, Types } from 'mongoose';
import {
  KnowledgeAssetType,
  KnowledgeLifecycle,
  KnowledgeQuality,
  knowledgeAssetTypes,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
} from './knowledge.types';

export interface IKnowledgeAsset {
  assetType: KnowledgeAssetType;
  title: string;
  description: string;
  collections: Types.ObjectId[];
  domain: string;
  ownerDomain: string;
  knowledgeSteward: string;
  quality: KnowledgeQuality;
  lifecycle: KnowledgeLifecycle;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const qualitySchema = new Schema<KnowledgeQuality>(
  {
    level: { type: String, enum: knowledgeQualityLevels, required: true },
    score: { type: Number, required: true, min: 0, max: 100 },
    rationale: { type: String, required: true, trim: true, maxlength: 1000 },
    evaluatedAt: { type: Date, required: true },
  },
  { _id: false }
);

const lifecycleSchema = new Schema<KnowledgeLifecycle>(
  {
    stage: { type: String, enum: knowledgeLifecycleStages, required: true },
    enteredAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
    reason: { type: String, trim: true, maxlength: 1000, default: null },
  },
  { _id: false }
);

const knowledgeAssetSchema = new Schema<IKnowledgeAsset>(
  {
    assetType: { type: String, enum: knowledgeAssetTypes, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    collections: [{ type: Schema.Types.ObjectId, ref: 'KnowledgeCollection', required: true }],
    domain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    ownerDomain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    knowledgeSteward: { type: String, required: true, trim: true, maxlength: 200, index: true },
    quality: { type: qualitySchema, required: true },
    lifecycle: { type: lifecycleSchema, required: true },
    version: { type: Number, required: true, min: 1, default: 1, index: true },
  },
  { timestamps: true }
);

knowledgeAssetSchema.index({ domain: 1, assetType: 1, createdAt: -1 });
knowledgeAssetSchema.index({ createdAt: -1 });

export const KnowledgeAsset = model<IKnowledgeAsset>('KnowledgeAsset', knowledgeAssetSchema);
