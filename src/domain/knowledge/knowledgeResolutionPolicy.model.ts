import { Schema, model } from 'mongoose';
import {
  KnowledgeResolutionPolicyInput,
  knowledgeDomains,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
} from './knowledge.types';

export interface IKnowledgeResolutionPolicy extends KnowledgeResolutionPolicyInput {
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeResolutionPolicySchema = new Schema<IKnowledgeResolutionPolicy>(
  {
    allowedDomains: { type: [String], enum: knowledgeDomains, required: true, default: [] },
    minimumQuality: { type: String, enum: knowledgeQualityLevels, required: true },
    allowedLifecycle: { type: [String], enum: knowledgeLifecycleStages, required: true, default: [] },
    maximumPackageSize: { type: Number, required: true, min: 1, max: 100 },
    includeDeprecated: { type: Boolean, default: false },
    includeCandidate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const KnowledgeResolutionPolicy = model<IKnowledgeResolutionPolicy>(
  'KnowledgeResolutionPolicy',
  knowledgeResolutionPolicySchema
);
