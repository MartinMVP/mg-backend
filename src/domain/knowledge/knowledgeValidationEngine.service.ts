import { Types } from 'mongoose';
import { KnowledgeSnapshot } from './knowledgeSnapshot.model';
import { OutcomeRegistry } from './knowledgeOutcome.model';
import { KnowledgeValidationPolicyShape, ValidationConfidence, ValidationResult, ValidationScore } from './knowledgeValidation.types';

export const defaultKnowledgeValidationPolicy: KnowledgeValidationPolicyShape = {
  minimumEvidence: 60,
  minimumOutcome: 60,
  requiredHistory: 0,
  confidenceThreshold: 60,
  approvalRequired: false,
};

export async function collectOutcome(outcomeId: string | Types.ObjectId) {
  return OutcomeRegistry.findById(outcomeId).lean();
}

export function compareExpectation(outcome: any) {
  if (!outcome) return { match: false, outcomeScore: 0, rationale: 'Outcome not found.' };
  const scoreByOutcome = {
    successful: 100,
    partially_successful: 70,
    inconclusive: 45,
    unsuccessful: 20,
  } as const;
  return {
    match: ['successful', 'partially_successful'].includes(outcome.outcomeType),
    outcomeScore: scoreByOutcome[outcome.outcomeType as keyof typeof scoreByOutcome] || 0,
    rationale: `Outcome ${outcome.outcomeType} compared deterministically against expected knowledge utility.`,
  };
}

export async function measureEffectiveness(input: { snapshotId: string | Types.ObjectId; outcome: any }) {
  const snapshot = await KnowledgeSnapshot.findById(input.snapshotId).lean();
  const recordCount = snapshot?.records?.length || 0;
  const assetCount = snapshot?.assets?.length || 0;
  return {
    evidence: Math.min(100, recordCount * 25 + assetCount * 20),
    reproducibility: snapshot ? 100 : 0,
    governance: snapshot?.tenantId === 'default' ? 90 : 70,
  };
}

export function determineValidation(input: {
  score: ValidationScore;
  confidence: ValidationConfidence;
  policy?: KnowledgeValidationPolicyShape;
}): ValidationResult {
  const policy = input.policy || defaultKnowledgeValidationPolicy;
  if (input.confidence.overall < policy.confidenceThreshold) return 'inconclusive';
  if (input.score.overall >= 85) return 'confirmed';
  if (input.score.overall >= 60) return 'partially_confirmed';
  if (input.score.overall < 40) return 'rejected';
  return 'inconclusive';
}

export async function buildValidationResult(input: {
  snapshotId: string | Types.ObjectId;
  outcomeId: string | Types.ObjectId;
  policy?: KnowledgeValidationPolicyShape;
}) {
  const outcome = await collectOutcome(input.outcomeId);
  const expectation = compareExpectation(outcome);
  const effectiveness = await measureEffectiveness({ snapshotId: input.snapshotId, outcome });
  const consistency = expectation.match ? 85 : 45;
  const score: ValidationScore = {
    evidence: effectiveness.evidence,
    outcome: expectation.outcomeScore,
    consistency,
    reproducibility: effectiveness.reproducibility,
    governance: effectiveness.governance,
    overall: Math.round((effectiveness.evidence + expectation.outcomeScore + consistency + effectiveness.reproducibility + effectiveness.governance) / 5),
  };
  const confidence: ValidationConfidence = {
    evidence: effectiveness.evidence >= 60 ? 80 : 45,
    outcome: expectation.outcomeScore >= 60 ? 80 : 45,
    overall: Math.round(((effectiveness.evidence >= 60 ? 80 : 45) + (expectation.outcomeScore >= 60 ? 80 : 45)) / 2),
  };
  const validationResult = determineValidation({ score, confidence, policy: input.policy });
  return { outcome, expectation, score, confidence, validationResult };
}
