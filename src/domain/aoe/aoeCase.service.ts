import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import {
  AOECase,
  AOECasePriority,
  aoeCasePriorities,
  AOECaseStatus,
  aoeCaseStatuses,
  AOECaseType,
  aoeCaseTypes,
  AOEEntityType,
  aoeEntityTypes,
} from './aoeCase.model';
import {
  countAOECases,
  createAOECase,
  findAOECaseById,
  listAOECases as listAOECaseDocuments,
  setAOECaseStatus,
} from './aoeCase.repository';
import { buildAOEDecisionProposal } from './aoeDecisionProposal.service';
import { addAOEEvidence, toObjectId } from './aoeEvidence.service';

export const aoeCaseAuditActions = {
  created: 'AOE_CASE_CREATED',
  viewed: 'AOE_CASE_VIEWED',
  escalated: 'AOE_CASE_ESCALATED',
  closed: 'AOE_CASE_CLOSED',
} as const;

const defaultLimit = 20;
const maxLimit = 100;

type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

type AuctionComplianceEvent = {
  event: 'AUCTION_DEFAULT_CONFIRMED' | 'AUCTION_SANCTION_APPLIED' | 'AUCTION_APPEAL_REQUESTED'
    | 'AUCTION_APPEAL_APPROVED' | 'AUCTION_APPEAL_REJECTED';
  entityId: string | Types.ObjectId;
  sourceId: string | Types.ObjectId;
  summary: string;
  metadata?: Record<string, unknown>;
  priority?: AOECasePriority;
};

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

function normalizePagination(input: PaginationInput = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

function assertCaseType(value: unknown): AOECaseType {
  if (!aoeCaseTypes.includes(value as AOECaseType)) reject(400, 'aoe_case_type_invalid');
  return value as AOECaseType;
}

function assertEntityType(value: unknown): AOEEntityType {
  if (!aoeEntityTypes.includes(value as AOEEntityType)) reject(400, 'aoe_entity_type_invalid');
  return value as AOEEntityType;
}

function assertPriority(value: unknown): AOECasePriority {
  if (!value) return 'medium';
  if (!aoeCasePriorities.includes(value as AOECasePriority)) reject(400, 'aoe_priority_invalid');
  return value as AOECasePriority;
}

function assertStatus(value: unknown): AOECaseStatus {
  if (!aoeCaseStatuses.includes(value as AOECaseStatus)) reject(400, 'aoe_case_status_invalid');
  return value as AOECaseStatus;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

async function getAOEPolicy() {
  const [
    enabled,
    collectEvidence,
    generateDecisionProposals,
    autoEscalate,
    executionEnabled,
  ] = await Promise.all([
    getConfigValue('aoe.enabled', 'sandbox', true),
    getConfigValue('aoe.collectEvidence', 'sandbox', true),
    getConfigValue('aoe.generateDecisionProposals', 'sandbox', true),
    getConfigValue('aoe.autoEscalate', 'sandbox', true),
    getConfigValue('aoe.executionEnabled', 'sandbox', false),
  ]);
  return {
    enabled: Boolean(enabled),
    collectEvidence: Boolean(collectEvidence),
    generateDecisionProposals: Boolean(generateDecisionProposals),
    autoEscalate: Boolean(autoEscalate),
    executionEnabled: false && Boolean(executionEnabled),
  };
}

export async function createPlatformAOECase(input: {
  type: unknown;
  entityType: unknown;
  entityId: string | Types.ObjectId;
  priority?: unknown;
  createdBy?: 'system' | 'admin';
}) {
  const aoeCase = await createAOECase({
    type: assertCaseType(input.type),
    entityType: assertEntityType(input.entityType),
    entityId: toObjectId(input.entityId),
    priority: assertPriority(input.priority),
    status: 'open',
    createdBy: input.createdBy || 'system',
  });
  await audit(input.createdBy || 'system', aoeCaseAuditActions.created, {
    aoeCaseId: String(aoeCase._id),
    type: aoeCase.type,
    entityType: aoeCase.entityType,
    entityId: String(aoeCase.entityId),
  });
  return aoeCase;
}

export async function observeAuctionComplianceEvent(input: AuctionComplianceEvent) {
  const policy = await getAOEPolicy();
  if (!policy.enabled) return null;

  const typeByEvent: Record<AuctionComplianceEvent['event'], AOECaseType> = {
    AUCTION_DEFAULT_CONFIRMED: 'auction_default',
    AUCTION_SANCTION_APPLIED: 'sanction_review',
    AUCTION_APPEAL_REQUESTED: 'appeal_review',
    AUCTION_APPEAL_APPROVED: 'appeal_review',
    AUCTION_APPEAL_REJECTED: 'appeal_review',
  };
  const entityTypeByEvent: Record<AuctionComplianceEvent['event'], AOEEntityType> = {
    AUCTION_DEFAULT_CONFIRMED: 'auction',
    AUCTION_SANCTION_APPLIED: 'sanction',
    AUCTION_APPEAL_REQUESTED: 'appeal',
    AUCTION_APPEAL_APPROVED: 'appeal',
    AUCTION_APPEAL_REJECTED: 'appeal',
  };
  const sourceTypeByEvent = input.event.includes('APPEAL')
    ? 'appeal'
    : input.event.includes('SANCTION')
      ? 'sanction'
      : 'auction';

  const aoeCase = await createPlatformAOECase({
    type: typeByEvent[input.event],
    entityType: entityTypeByEvent[input.event],
    entityId: input.entityId,
    priority: input.priority || (input.event.includes('APPEAL') ? 'high' : 'medium'),
    createdBy: 'system',
  });

  if (policy.collectEvidence) {
    await addAOEEvidence({
      aoeCaseId: aoeCase._id,
      sourceType: sourceTypeByEvent,
      sourceId: input.sourceId,
      summary: input.summary,
      metadata: {
        event: input.event,
        ...input.metadata,
      },
      confidence: input.event.includes('APPEAL') ? 85 : 80,
    });
    aoeCase.status = 'collecting_evidence';
    await aoeCase.save();
  }

  if (policy.generateDecisionProposals) {
    await buildAOEDecisionProposal(aoeCase._id);
  }

  return aoeCase;
}

export async function listAOECases(filters: PaginationInput & {
  status?: AOECaseStatus;
  type?: AOECaseType;
  priority?: AOECasePriority;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = assertStatus(filters.status);
  if (filters.type) query.type = assertCaseType(filters.type);
  if (filters.priority) query.priority = assertPriority(filters.priority);

  const [total, cases] = await Promise.all([
    countAOECases(query),
    listAOECaseDocuments(query, pagination.skip, pagination.limit),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, cases };
}

export async function getAOECase(id: string | Types.ObjectId) {
  const aoeCase = await AOECase.findById(toObjectId(id)).lean();
  if (!aoeCase) reject(404, 'aoe_case_not_found');
  return aoeCase;
}

export async function markAOECaseViewed(input: {
  caseId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const aoeCase = await findAOECaseById(toObjectId(input.caseId));
  if (!aoeCase) reject(404, 'aoe_case_not_found');
  await audit(String(input.actorId), aoeCaseAuditActions.viewed, { aoeCaseId: String(aoeCase._id) });
  return aoeCase;
}

export async function escalateAOECase(input: {
  caseId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const aoeCase = await setAOECaseStatus(toObjectId(input.caseId), 'escalated');
  if (!aoeCase) reject(404, 'aoe_case_not_found');
  await audit(String(input.actorId), aoeCaseAuditActions.escalated, { aoeCaseId: String(aoeCase._id) });
  return aoeCase;
}

export async function closeAOECase(input: {
  caseId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const aoeCase = await setAOECaseStatus(toObjectId(input.caseId), 'closed', { closedAt: new Date() });
  if (!aoeCase) reject(404, 'aoe_case_not_found');
  await audit(String(input.actorId), aoeCaseAuditActions.closed, { aoeCaseId: String(aoeCase._id) });
  return aoeCase;
}
