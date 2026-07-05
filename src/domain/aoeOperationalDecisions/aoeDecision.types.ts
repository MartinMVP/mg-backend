import { Types } from 'mongoose';

export const aoeOperationalDecisionTypes = [
  'sanction_review',
  'appeal_review',
  'default_review',
  'fraud_signal',
  'operational_alert',
  'membership_signal',
  'revenue_signal',
  'messaging_signal',
  'marketplace_signal',
] as const;
export type AOEOperationalDecisionType = typeof aoeOperationalDecisionTypes[number];

export const aoeOperationalDecisionStatuses = ['generated', 'viewed', 'escalated', 'closed'] as const;
export type AOEOperationalDecisionStatus = typeof aoeOperationalDecisionStatuses[number];

export const aoeDecisionUncertaintyValues = ['low', 'medium', 'high'] as const;
export type AOEDecisionUncertainty = typeof aoeDecisionUncertaintyValues[number];

export const aoeDecisionRiskLevels = ['low', 'medium', 'high', 'critical'] as const;
export type AOEDecisionRiskLevel = typeof aoeDecisionRiskLevels[number];

export const aoeDecisionAlternativeActions = [
  'no_action',
  'warning',
  'escalate',
  'request_more_evidence',
  'suggest_sanction',
  'suggest_appeal_approval',
  'suggest_appeal_rejection',
] as const;
export type AOEDecisionAlternativeAction = typeof aoeDecisionAlternativeActions[number];

export type AOEDecisionConfidence = {
  overall: number;
  evidence: number;
  analytics: number;
  historical: number;
  consistency: number;
};

export type AOEDecisionContext = {
  aoeCase: any;
  proposal: any | null;
  evidence: any[];
  auditSummary: {
    totalEvents: number;
    actions: Array<{ action: string; count: number }>;
  };
  analyticsSummary: {
    totalEvents: number;
    tags: Array<{ tag: string; count: number }>;
    domains: Array<{ domain: string; count: number }>;
    correlationIds: string[];
  };
  qualitySummary: {
    passed: boolean;
    failedGates: string[];
    recommendedMode: string;
    warnings: string[];
  };
  platformConfiguration: {
    decisionEngineVersion: string;
    expirationDays: number;
  };
};

export type AOEOperationalDecisionInput = {
  aoeCaseId: string | Types.ObjectId;
  proposalId?: string | Types.ObjectId;
  actorId?: string | Types.ObjectId;
};

export type AOEOperationalDecisionOutcomeReference = {
  businessOutcome?: string;
  operationalOutcome?: string;
  knowledgeOutcome?: string;
};
