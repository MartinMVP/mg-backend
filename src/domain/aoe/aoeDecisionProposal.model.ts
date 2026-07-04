import { Schema, model, Types } from 'mongoose';

export const aoeDecisionProposalTypes = [
  'warning',
  'need_more_evidence',
  'suggest_sanction',
  'suggest_appeal_approval',
  'suggest_appeal_rejection',
  'escalate',
] as const;
export type AOEDecisionProposalType = typeof aoeDecisionProposalTypes[number];

export const aoeLearningFeedbackValues = ['accepted', 'rejected', 'modified', 'unresolved'] as const;
export type AOELearningFeedback = typeof aoeLearningFeedbackValues[number];

export const aoeDecisionProposalStatuses = ['generated', 'viewed', 'escalated', 'closed'] as const;
export type AOEDecisionProposalStatus = typeof aoeDecisionProposalStatuses[number];

export interface IAOEDecisionProposal {
  aoeCaseId: Types.ObjectId;
  proposalType: AOEDecisionProposalType;
  confidence: number;
  confidenceReason: string[];
  explanation: string;
  proposedAction: string;
  learningFeedback: AOELearningFeedback;
  status: AOEDecisionProposalStatus;
  createdAt: Date;
}

const aoeDecisionProposalSchema = new Schema<IAOEDecisionProposal>(
  {
    aoeCaseId: { type: Schema.Types.ObjectId, ref: 'AOECase', required: true, index: true },
    proposalType: { type: String, enum: aoeDecisionProposalTypes, required: true, index: true },
    confidence: { type: Number, required: true, min: 0, max: 100 },
    confidenceReason: {
      type: [String],
      required: true,
      validate: {
        validator: (value: string[]) => Array.isArray(value) && value.length > 0,
        message: 'confidence_reason_required',
      },
    },
    explanation: { type: String, required: true, trim: true, maxlength: 3000 },
    proposedAction: { type: String, required: true, trim: true, maxlength: 1000 },
    learningFeedback: { type: String, enum: aoeLearningFeedbackValues, default: 'unresolved', index: true },
    status: { type: String, enum: aoeDecisionProposalStatuses, default: 'generated', index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

aoeDecisionProposalSchema.index({ aoeCaseId: 1, createdAt: -1 });
aoeDecisionProposalSchema.index({ createdAt: -1 });

export const AOEDecisionProposal = model<IAOEDecisionProposal>(
  'AOEDecisionProposal',
  aoeDecisionProposalSchema
);
