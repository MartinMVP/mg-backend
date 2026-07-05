import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { KnowledgeAsset } from './knowledgeAsset.model';
import { KnowledgeDrift } from './knowledgeDrift.model';
import { KnowledgeSnapshot } from './knowledgeSnapshot.model';
import { OutcomeRegistry } from './knowledgeOutcome.model';
import { createKnowledgeValidationDocument, findKnowledgeValidationById, listKnowledgeValidations, countKnowledgeValidations } from './knowledgeValidation.repository';
import { KnowledgeValidationHistory } from './knowledgeValidationHistory.model';
import { KnowledgeValidationPolicy } from './knowledgeValidationPolicy.model';
import { KnowledgeValidationSnapshot } from './knowledgeValidationSnapshot.model';
import { buildValidationResult, defaultKnowledgeValidationPolicy } from './knowledgeValidationEngine.service';
import { DriftType, KnowledgeStability, KnowledgeTrustPreparation, ValidationMethod, driftTypes } from './knowledgeValidation.types';

export const knowledgeValidationAuditActions = {
  validated: 'KNOWLEDGE_VALIDATED',
  recorded: 'KNOWLEDGE_VALIDATION_RECORDED',
  snapshotCreated: 'KNOWLEDGE_VALIDATION_SNAPSHOT_CREATED',
  driftDetected: 'KNOWLEDGE_DRIFT_DETECTED',
  stabilityCalculated: 'KNOWLEDGE_STABILITY_CALCULATED',
} as const;

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

function objectId(id: string) {
  if (!Types.ObjectId.isValid(id)) reject(400, 'invalid_object_id');
  return new Types.ObjectId(id);
}

async function audit(actor: string, action: string) {
  await Audit.create({ actor, action });
}

export async function createValidationPolicy(input = defaultKnowledgeValidationPolicy) {
  return KnowledgeValidationPolicy.create(input);
}

export async function calculateKnowledgeStability(assetId: string | Types.ObjectId): Promise<KnowledgeStability> {
  const validations = await KnowledgeValidationHistory.findOne({ assetId }).lean();
  const count = validations?.validations?.length || 0;
  const stability = {
    confirmations: count,
    consecutiveConfirmations: count,
    stabilityScore: Math.min(100, count * 25),
  };
  await audit('system', knowledgeValidationAuditActions.stabilityCalculated);
  return stability;
}

export async function prepareKnowledgeTrust(assetId: string | Types.ObjectId): Promise<KnowledgeTrustPreparation> {
  return { prepared: true, trustReady: false, stability: await calculateKnowledgeStability(assetId) };
}

export async function detectKnowledgeDrift(input: {
  assetId: string | Types.ObjectId;
  driftType: DriftType;
  previousScore: number;
  currentScore: number;
}) {
  if (!driftTypes.includes(input.driftType)) reject(400, 'invalid_drift_type');
  const delta = Math.abs(input.previousScore - input.currentScore);
  const drift = await KnowledgeDrift.create({
    tenantId: 'default',
    assetId: input.assetId,
    driftType: input.driftType,
    driftDetected: delta >= 15,
    previousScore: input.previousScore,
    currentScore: input.currentScore,
    severity: delta >= 50 ? 'critical' : delta >= 30 ? 'high' : delta >= 15 ? 'medium' : 'low',
  });
  if (drift.driftDetected) await audit('system', knowledgeValidationAuditActions.driftDetected);
  return drift.toObject();
}

export async function validateKnowledge(input: {
  packageId: string;
  snapshotId: string;
  outcomeId: string;
  validationLevel?: string;
  validationMethod?: ValidationMethod;
  validatedBy?: string | null;
  actorId?: string;
  policy?: typeof defaultKnowledgeValidationPolicy;
}) {
  if (input.validationLevel && input.validationLevel !== 'knowledge_validation') reject(400, 'unsupported_validation_level');
  const [knowledgeSnapshot, outcome] = await Promise.all([
    KnowledgeSnapshot.findById(objectId(input.snapshotId)).lean(),
    OutcomeRegistry.findById(objectId(input.outcomeId)).lean(),
  ]);
  if (!knowledgeSnapshot) reject(404, 'knowledge_snapshot_not_found');
  if (!outcome) reject(404, 'outcome_not_found');

  const built = await buildValidationResult({
    snapshotId: input.snapshotId,
    outcomeId: input.outcomeId,
    policy: input.policy,
  });
  const now = new Date();
  const validation = await createKnowledgeValidationDocument({
    tenantId: 'default',
    validationLevel: 'knowledge_validation',
    packageId: objectId(input.packageId),
    snapshotId: objectId(input.snapshotId),
    outcomeId: objectId(input.outcomeId),
    validationResult: built.validationResult,
    validationScore: built.score,
    validationConfidence: built.confidence,
    validationProvenance: {
      validatedBy: input.validatedBy && Types.ObjectId.isValid(input.validatedBy) ? new Types.ObjectId(input.validatedBy) : null,
      validationMethod: input.validationMethod || 'system_check',
      validationRules: ['outcome.expectedUtility', 'snapshot.reproducibility', 'governance.tenantDefault'],
      validationVersion: 'Knowledge Validation v1.0',
      validationTimestamp: now,
    },
    rationale: built.expectation.rationale,
    validatedBy: input.validatedBy && Types.ObjectId.isValid(input.validatedBy) ? new Types.ObjectId(input.validatedBy) : null,
    validatedAt: now,
  });

  const validationSnapshot = await KnowledgeValidationSnapshot.create({
    tenantId: 'default',
    validationId: validation._id,
    knowledgeSnapshot,
    outcomeSnapshot: outcome,
    validationSnapshot: validation.toObject(),
    ruleSnapshot: input.policy || defaultKnowledgeValidationPolicy,
  });

  const assetIds = knowledgeSnapshot.assets || [];
  await Promise.all(assetIds.map(async (assetId: Types.ObjectId) => {
    await KnowledgeValidationHistory.create({
      tenantId: 'default',
      assetId,
      validations: [validation._id],
      trends: { latestResult: validation.validationResult, latestScore: validation.validationScore.overall },
    });
    const asset = await KnowledgeAsset.findById(assetId).lean();
    if (asset) await detectKnowledgeDrift({
      assetId,
      driftType: 'outcome',
      previousScore: asset.quality?.score || 0,
      currentScore: validation.validationScore.overall,
    });
  }));

  await audit(input.actorId || 'system', knowledgeValidationAuditActions.validated);
  await audit(input.actorId || 'system', knowledgeValidationAuditActions.recorded);
  await audit(input.actorId || 'system', knowledgeValidationAuditActions.snapshotCreated);
  return { validation: validation.toObject(), validationSnapshot: validationSnapshot.toObject() };
}

export async function getValidation(id: string) {
  const validation = await findKnowledgeValidationById(objectId(id));
  if (!validation) reject(404, 'knowledge_validation_not_found');
  return validation;
}

export async function listValidations(input: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([listKnowledgeValidations(skip, limit), countKnowledgeValidations()]);
  return { items, page, limit, total };
}

export async function listDrift() {
  const items = await KnowledgeDrift.find().sort({ createdAt: -1 }).lean();
  return { items, total: items.length };
}

export async function getValidationHistory(assetId: string) {
  const history = await KnowledgeValidationHistory.find({ assetId: objectId(assetId) }).sort({ createdAt: -1 }).lean();
  return { items: history, total: history.length };
}

export async function getAOEValidationContext(assetId: string) {
  return {
    contextOnly: true,
    learningEnabled: false,
    ruleAdaptationEnabled: false,
    automationEnabled: false,
    trust: await prepareKnowledgeTrust(objectId(assetId)),
  };
}
