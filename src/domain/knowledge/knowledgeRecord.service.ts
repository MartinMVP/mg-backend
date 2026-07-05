import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import {
  CreateKnowledgeRecordInput,
  KnowledgeRecordVersionChanges,
  knowledgeDomains,
  knowledgeSourceTypes,
} from './knowledge.types';
import {
  createKnowledgeRecordDocument,
  findKnowledgeRecordById,
  listKnowledgeRecords as listKnowledgeRecordDocuments,
  countKnowledgeRecords,
} from './knowledgeRecord.repository';
import { registerKnowledgeRecord } from './knowledgeRegistry.service';

export const knowledgeRecordAuditActions = {
  created: 'KNOWLEDGE_RECORD_CREATED',
  versioned: 'KNOWLEDGE_RECORD_VERSIONED',
  validated: 'KNOWLEDGE_RECORD_VALIDATED',
} as const;

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

function parseObjectId(id: string) {
  if (!Types.ObjectId.isValid(id)) reject(400, 'invalid_object_id');
  return new Types.ObjectId(id);
}

function assertDomain(value: any) {
  if (!knowledgeDomains.includes(value)) reject(400, 'invalid_knowledge_domain');
}

function assertSourceType(value: any) {
  if (!knowledgeSourceTypes.includes(value)) reject(400, 'invalid_source_type');
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, ...(payload as any) });
}

export async function createKnowledgeRecord(input: CreateKnowledgeRecordInput & { actorId?: string }) {
  assertDomain(input.knowledgeDomain);
  assertSourceType(input.sourceType);
  if (!input.knowledgeType || typeof input.knowledgeType !== 'string') reject(400, 'knowledge_type_required');
  if (!input.facts || typeof input.facts !== 'object' || Array.isArray(input.facts)) reject(400, 'facts_required');

  const now = new Date();
  const record = await createKnowledgeRecordDocument({
    knowledgeDomain: input.knowledgeDomain,
    knowledgeType: input.knowledgeType,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    facts: input.facts,
    context: input.context || {},
    provenance: {
      ...input.provenance,
      sourceEvidence: input.provenance.sourceEvidence || [],
      rulesVersion: input.provenance.rulesVersion ?? null,
      engineVersion: input.provenance.engineVersion ?? null,
      validatedBy: input.provenance.validatedBy ?? null,
      approvedBy: input.provenance.approvedBy ?? null,
      createdAt: input.provenance.createdAt || now,
      validatedAt: input.provenance.validatedAt ?? null,
      approvedAt: input.provenance.approvedAt ?? null,
    },
    version: input.version || 1,
  });

  await audit(input.actorId || 'system', knowledgeRecordAuditActions.created, { knowledgeRecordId: record._id });
  await registerKnowledgeRecord({ record, producer: input.producer, actorId: input.actorId });
  return record.toObject();
}

export async function createKnowledgeRecordVersion(input: {
  previousRecordId: string;
  changes: KnowledgeRecordVersionChanges;
  actorId?: string;
}) {
  const previousId = parseObjectId(input.previousRecordId);
  const previous = await findKnowledgeRecordById(previousId);
  if (!previous) reject(404, 'knowledge_record_not_found');

  const provenance = {
    ...previous.provenance,
    ...input.changes.provenance,
    sourceEvidence: input.changes.provenance?.sourceEvidence || previous.provenance.sourceEvidence || [],
    createdAt: new Date(),
  };

  const record = await createKnowledgeRecord({
    knowledgeDomain: previous.knowledgeDomain,
    knowledgeType: input.changes.knowledgeType || previous.knowledgeType,
    sourceType: input.changes.sourceType || previous.sourceType,
    sourceId: input.changes.sourceId ?? previous.sourceId ?? null,
    facts: input.changes.facts || previous.facts,
    context: input.changes.context || previous.context || {},
    provenance,
    version: previous.version + 1,
    producer: input.changes.producer || provenance.generatedBy,
    actorId: input.actorId,
  });

  await audit(input.actorId || 'system', knowledgeRecordAuditActions.versioned, {
    previousKnowledgeRecordId: previous._id,
    knowledgeRecordId: record._id,
    version: record.version,
  });

  return record;
}

export async function getKnowledgeRecord(id: string) {
  const record = await findKnowledgeRecordById(parseObjectId(id));
  if (!record) reject(404, 'knowledge_record_not_found');
  return record;
}

export async function listKnowledgeRecords(input: {
  page?: unknown;
  limit?: unknown;
  knowledgeDomain?: string;
  knowledgeType?: string;
  version?: unknown;
  sourceType?: string;
}) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const filter: Record<string, unknown> = {};
  if (input.knowledgeDomain) filter.knowledgeDomain = input.knowledgeDomain;
  if (input.knowledgeType) filter.knowledgeType = input.knowledgeType;
  if (input.sourceType) filter.sourceType = input.sourceType;
  if (input.version) filter.version = Number(input.version);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listKnowledgeRecordDocuments(filter, skip, limit),
    countKnowledgeRecords(filter),
  ]);
  return { items, page, limit, total };
}
