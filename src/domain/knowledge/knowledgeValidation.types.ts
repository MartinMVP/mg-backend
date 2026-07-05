import { Types } from 'mongoose';

export const outcomeTypes = ['successful', 'partially_successful', 'unsuccessful', 'inconclusive'] as const;
export type OutcomeType = typeof outcomeTypes[number];

export const validationLevels = [
  'evidence_validation',
  'knowledge_validation',
  'rule_validation',
  'decision_validation',
  'outcome_validation',
] as const;
export type ValidationLevel = typeof validationLevels[number];
export type ImplementedValidationLevel = 'knowledge_validation';

export const validationResults = ['confirmed', 'partially_confirmed', 'rejected', 'inconclusive'] as const;
export type ValidationResult = typeof validationResults[number];

export const validationMethods = ['human_review', 'admin_review', 'system_check', 'imported'] as const;
export type ValidationMethod = typeof validationMethods[number];

export const driftTypes = ['business', 'rule', 'evidence', 'outcome'] as const;
export type DriftType = typeof driftTypes[number];

export const driftSeverities = ['low', 'medium', 'high', 'critical'] as const;
export type DriftSeverity = typeof driftSeverities[number];

export interface ValidationProvenance {
  validatedBy?: Types.ObjectId | null;
  validationMethod: ValidationMethod;
  validationRules: string[];
  validationVersion: 'Knowledge Validation v1.0';
  validationTimestamp: Date;
}

export interface ValidationScore {
  evidence: number;
  outcome: number;
  consistency: number;
  reproducibility: number;
  governance: number;
  overall: number;
}

export interface ValidationConfidence {
  overall: number;
  evidence: number;
  outcome: number;
}

export interface KnowledgeValidationPolicyShape {
  minimumEvidence: number;
  minimumOutcome: number;
  requiredHistory: number;
  confidenceThreshold: number;
  approvalRequired: boolean;
}

export interface KnowledgeStability {
  confirmations: number;
  consecutiveConfirmations: number;
  stabilityScore: number;
}

export interface KnowledgeTrustPreparation {
  prepared: true;
  trustReady: false;
  stability: KnowledgeStability;
}
