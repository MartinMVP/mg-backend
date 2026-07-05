import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { OutcomeType, outcomeTypes } from './knowledgeValidation.types';
import { countOutcomes, createOutcomeRegistryDocument, findOutcomeById, listOutcomes } from './knowledgeOutcome.repository';

export const outcomeAuditActions = {
  registered: 'OUTCOME_REGISTERED',
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

export async function registerOutcome(input: {
  tenantId?: string;
  outcomeType: OutcomeType;
  sourceDomain: string;
  sourceId?: string | Types.ObjectId | null;
  businessOutcome: string;
  operationalOutcome: string;
  knowledgeOutcome: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
}) {
  if (!outcomeTypes.includes(input.outcomeType)) reject(400, 'invalid_outcome_type');
  if (!input.sourceDomain) reject(400, 'source_domain_required');
  const outcome = await createOutcomeRegistryDocument({
    tenantId: input.tenantId || 'default',
    outcomeType: input.outcomeType,
    sourceDomain: input.sourceDomain,
    sourceId: input.sourceId ?? null,
    businessOutcome: input.businessOutcome,
    operationalOutcome: input.operationalOutcome,
    knowledgeOutcome: input.knowledgeOutcome,
    metadata: input.metadata || {},
  });
  await Audit.create({ actor: input.actorId || 'system', action: outcomeAuditActions.registered });
  return outcome.toObject();
}

export async function getOutcome(id: string) {
  const outcome = await findOutcomeById(objectId(id));
  if (!outcome) reject(404, 'outcome_not_found');
  return outcome;
}

export async function listOutcomeRegistry(input: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([listOutcomes(skip, limit), countOutcomes()]);
  return { items, page, limit, total };
}
