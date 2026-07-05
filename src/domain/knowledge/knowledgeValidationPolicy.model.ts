import { Schema, model } from 'mongoose';
import { KnowledgeValidationPolicyShape } from './knowledgeValidation.types';

export interface IKnowledgeValidationPolicy extends KnowledgeValidationPolicyShape {
  createdAt: Date;
  updatedAt: Date;
}

const knowledgeValidationPolicySchema = new Schema<IKnowledgeValidationPolicy>(
  {
    minimumEvidence: { type: Number, min: 0, max: 100, required: true },
    minimumOutcome: { type: Number, min: 0, max: 100, required: true },
    requiredHistory: { type: Number, min: 0, required: true },
    confidenceThreshold: { type: Number, min: 0, max: 100, required: true },
    approvalRequired: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const KnowledgeValidationPolicy = model<IKnowledgeValidationPolicy>(
  'KnowledgeValidationPolicy',
  knowledgeValidationPolicySchema
);
