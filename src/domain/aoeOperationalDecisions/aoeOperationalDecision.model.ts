import { Schema, model, Types } from 'mongoose';
import {
  AOEDecisionRiskLevel,
  AOEDecisionUncertainty,
  AOEOperationalDecisionStatus,
  AOEOperationalDecisionType,
  aoeDecisionRiskLevels,
  aoeDecisionUncertaintyValues,
  aoeOperationalDecisionStatuses,
  aoeOperationalDecisionTypes,
} from './aoeDecision.types';

export interface IAOEOperationalDecisionPackage {
  aoeCaseId: Types.ObjectId;
  proposalId?: Types.ObjectId;
  decisionType: AOEOperationalDecisionType;
  decisionEngineVersion: string;
  facts: Record<string, unknown>;
  interpretation: Record<string, unknown>;
  appliedRules: string[];
  evidenceSummary: Record<string, unknown>;
  analyticsSummary: Record<string, unknown>;
  qualitySummary: Record<string, unknown>;
  confidence: Record<string, number>;
  uncertainty: AOEDecisionUncertainty;
  riskLevel: AOEDecisionRiskLevel;
  missingEvidence: string[];
  requiredHumanSkills: string[];
  recommendedAction: string;
  alternativeActions: string[];
  narrative: Record<string, unknown>;
  humanReviewRequired: boolean;
  outcomePreparation?: Record<string, unknown>;
  generatedAt: Date;
  expiresAt: Date;
  status: AOEOperationalDecisionStatus;
  createdAt: Date;
  updatedAt: Date;
}

const aoeOperationalDecisionPackageSchema = new Schema<IAOEOperationalDecisionPackage>(
  {
    aoeCaseId: { type: Schema.Types.ObjectId, ref: 'AOECase', required: true, index: true },
    proposalId: { type: Schema.Types.ObjectId, ref: 'AOEDecisionProposal', index: true },
    decisionType: { type: String, enum: aoeOperationalDecisionTypes, required: true, index: true },
    decisionEngineVersion: { type: String, required: true, default: 'AOE Decision Engine v1.0' },
    facts: { type: Schema.Types.Mixed, required: true },
    interpretation: { type: Schema.Types.Mixed, required: true },
    appliedRules: { type: [String], required: true, default: [] },
    evidenceSummary: { type: Schema.Types.Mixed, required: true },
    analyticsSummary: { type: Schema.Types.Mixed, required: true },
    qualitySummary: { type: Schema.Types.Mixed, required: true },
    confidence: { type: Schema.Types.Mixed, required: true },
    uncertainty: { type: String, enum: aoeDecisionUncertaintyValues, required: true, index: true },
    riskLevel: { type: String, enum: aoeDecisionRiskLevels, required: true, index: true },
    missingEvidence: { type: [String], default: [] },
    requiredHumanSkills: { type: [String], default: [] },
    recommendedAction: { type: String, required: true, trim: true, maxlength: 1000 },
    alternativeActions: { type: [String], default: [] },
    narrative: { type: Schema.Types.Mixed, required: true },
    humanReviewRequired: { type: Boolean, default: true, index: true },
    outcomePreparation: { type: Schema.Types.Mixed },
    generatedAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    status: { type: String, enum: aoeOperationalDecisionStatuses, default: 'generated', index: true },
  },
  { timestamps: true }
);

aoeOperationalDecisionPackageSchema.index({ aoeCaseId: 1, createdAt: -1 });
aoeOperationalDecisionPackageSchema.index({ createdAt: -1 });

export const AOEOperationalDecisionPackage = model<IAOEOperationalDecisionPackage>(
  'AOEOperationalDecisionPackage',
  aoeOperationalDecisionPackageSchema
);
