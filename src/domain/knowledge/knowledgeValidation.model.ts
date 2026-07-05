import { Schema, model, Types } from 'mongoose';
import {
  ImplementedValidationLevel,
  ValidationConfidence,
  ValidationProvenance,
  ValidationResult,
  ValidationScore,
  validationMethods,
  validationResults,
} from './knowledgeValidation.types';

export interface IKnowledgeValidation {
  tenantId: string;
  validationLevel: ImplementedValidationLevel;
  packageId: Types.ObjectId;
  snapshotId: Types.ObjectId;
  outcomeId: Types.ObjectId;
  validationResult: ValidationResult;
  validationScore: ValidationScore;
  validationConfidence: ValidationConfidence;
  validationProvenance: ValidationProvenance;
  rationale: string;
  validatedBy?: Types.ObjectId | null;
  validatedAt: Date;
  createdAt: Date;
}

const scoreSchema = new Schema<ValidationScore>({
  evidence: { type: Number, min: 0, max: 100, required: true },
  outcome: { type: Number, min: 0, max: 100, required: true },
  consistency: { type: Number, min: 0, max: 100, required: true },
  reproducibility: { type: Number, min: 0, max: 100, required: true },
  governance: { type: Number, min: 0, max: 100, required: true },
  overall: { type: Number, min: 0, max: 100, required: true },
}, { _id: false });

const confidenceSchema = new Schema<ValidationConfidence>({
  overall: { type: Number, min: 0, max: 100, required: true },
  evidence: { type: Number, min: 0, max: 100, required: true },
  outcome: { type: Number, min: 0, max: 100, required: true },
}, { _id: false });

const provenanceSchema = new Schema<ValidationProvenance>({
  validatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  validationMethod: { type: String, enum: validationMethods, required: true },
  validationRules: { type: [String], default: [] },
  validationVersion: { type: String, required: true, default: 'Knowledge Validation v1.0' },
  validationTimestamp: { type: Date, required: true },
}, { _id: false });

const knowledgeValidationSchema = new Schema<IKnowledgeValidation>(
  {
    tenantId: { type: String, required: true, default: 'default', index: true },
    validationLevel: { type: String, enum: ['knowledge_validation'], required: true, index: true },
    packageId: { type: Schema.Types.ObjectId, ref: 'KnowledgeUtilizationPackage', required: true, index: true },
    snapshotId: { type: Schema.Types.ObjectId, ref: 'KnowledgeSnapshot', required: true, index: true },
    outcomeId: { type: Schema.Types.ObjectId, ref: 'OutcomeRegistry', required: true, index: true },
    validationResult: { type: String, enum: validationResults, required: true, index: true },
    validationScore: { type: scoreSchema, required: true },
    validationConfidence: { type: confidenceSchema, required: true },
    validationProvenance: { type: provenanceSchema, required: true },
    rationale: { type: String, required: true, trim: true, maxlength: 2000 },
    validatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    validatedAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

export const KnowledgeValidation = model<IKnowledgeValidation>('KnowledgeValidation', knowledgeValidationSchema);
