import { Schema, model } from 'mongoose';
import {
  KnowledgeConsumerContract,
  knowledgeAssetTypes,
  knowledgeConsumerTypes,
  knowledgeDomains,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
} from './knowledge.types';

export interface IKnowledgeConsumer extends KnowledgeConsumerContract {
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeConsumerSchema = new Schema<IKnowledgeConsumer>(
  {
    consumerType: { type: String, enum: knowledgeConsumerTypes, required: true, index: true },
    ownerDomain: { type: String, required: true, trim: true, maxlength: 200, index: true },
    steward: { type: String, required: true, trim: true, maxlength: 200, index: true },
    allowedDomains: { type: [String], enum: knowledgeDomains, required: true, default: [] },
    allowedAssetTypes: { type: [String], enum: knowledgeAssetTypes, required: true, default: [] },
    minimumKnowledgeQuality: { type: String, enum: knowledgeQualityLevels, required: true },
    maximumKnowledgeAge: { type: Number, default: null },
    preferredLifecycle: { type: [String], enum: knowledgeLifecycleStages, required: true, default: [] },
    purposeCategory: { type: String, required: true, trim: true, maxlength: 200, index: true },
  },
  { timestamps: true }
);

knowledgeConsumerSchema.index({ consumerType: 1, ownerDomain: 1, purposeCategory: 1 });

export const KnowledgeConsumer = model<IKnowledgeConsumer>('KnowledgeConsumer', knowledgeConsumerSchema);
