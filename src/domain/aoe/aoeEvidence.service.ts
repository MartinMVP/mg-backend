import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { AOEEvidence, AOEEvidenceSourceType, aoeEvidenceSourceTypes } from './aoeEvidence.model';

export const aoeEvidenceAuditActions = {
  added: 'AOE_EVIDENCE_ADDED',
} as const;

const sensitiveMetadataKey = /(secret|token|password|authorization|cookie|payload|raw|api[-_]?key|private[-_]?key)/i;

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

export function toObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw new Error('invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function assertSourceType(value: unknown): AOEEvidenceSourceType {
  if (!aoeEvidenceSourceTypes.includes(value as AOEEvidenceSourceType)) reject(400, 'aoe_evidence_source_type_invalid');
  return value as AOEEvidenceSourceType;
}

function normalizeConfidence(value: unknown, fallback = 70) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(0, Math.floor(parsed)));
}

function sanitizeMetadataValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeMetadataValue);
  if (typeof value === 'object') return '[object]';
  return undefined;
}

function sanitizeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return undefined;
  const sanitized = Object.entries(metadata).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (!key || sensitiveMetadataKey.test(key)) return acc;
    const sanitizedValue = sanitizeMetadataValue(value);
    if (sanitizedValue !== undefined) acc[key] = sanitizedValue;
    return acc;
  }, {});
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

export async function addAOEEvidence(input: {
  aoeCaseId: string | Types.ObjectId;
  sourceType: unknown;
  sourceId: string | Types.ObjectId;
  summary: unknown;
  metadata?: Record<string, unknown>;
  confidence?: unknown;
  actor?: string;
}) {
  const aoeCaseId = toObjectId(input.aoeCaseId);
  const sourceId = toObjectId(input.sourceId);
  const sourceType = assertSourceType(input.sourceType);
  const summary = String(input.summary || '').trim();
  if (!summary) reject(400, 'aoe_evidence_summary_required');

  const evidence = await AOEEvidence.create({
    aoeCaseId,
    sourceType,
    sourceId,
    summary,
    metadata: sanitizeMetadata(input.metadata),
    confidence: normalizeConfidence(input.confidence),
  });
  await audit(input.actor || 'system', aoeEvidenceAuditActions.added, {
    aoeCaseId: String(aoeCaseId),
    aoeEvidenceId: String(evidence._id),
    sourceType,
    sourceId: String(sourceId),
  });
  return evidence;
}

export async function listAOEEvidenceForCase(aoeCaseId: string | Types.ObjectId) {
  return AOEEvidence.find({ aoeCaseId: toObjectId(aoeCaseId) }).sort({ createdAt: 1 }).lean();
}
