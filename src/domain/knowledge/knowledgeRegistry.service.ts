import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { IKnowledgeRecord } from './knowledgeRecord.model';
import {
  createKnowledgeRegistryEntry,
  findKnowledgeRegistryEntryByRecordId,
  listKnowledgeRegistryEntries,
  countKnowledgeRegistryEntries,
} from './knowledgeRegistry.repository';

export const knowledgeRegistryAuditActions = {
  registered: 'KNOWLEDGE_REGISTRY_REGISTERED',
} as const;

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, ...(payload as any) });
}

export async function registerKnowledgeRecord(input: {
  record: IKnowledgeRecord & { _id: Types.ObjectId };
  producer?: string;
  actorId?: string;
}) {
  const existing = await findKnowledgeRegistryEntryByRecordId(input.record._id);
  if (existing) return existing;

  const entry = await createKnowledgeRegistryEntry({
    knowledgeRecordId: input.record._id,
    knowledgeDomain: input.record.knowledgeDomain,
    knowledgeType: input.record.knowledgeType,
    version: input.record.version,
    producer: input.producer || input.record.provenance.generatedBy || 'system',
    location: {
      storageType: 'mongodb',
      reference: `KnowledgeRecord:${String(input.record._id)}`,
    },
  });

  await audit(input.actorId || 'system', knowledgeRegistryAuditActions.registered, {
    knowledgeRecordId: input.record._id,
  });

  return entry;
}

export async function listKnowledgeRegistry(input: { page?: unknown; limit?: unknown }) {
  const page = Math.max(1, Number(input.page) || 1);
  const limit = Math.min(Math.max(1, Number(input.limit) || 50), 100);
  const skip = (page - 1) * limit;
  const [items, total] = await Promise.all([
    listKnowledgeRegistryEntries(skip, limit),
    countKnowledgeRegistryEntries(),
  ]);
  return { items, page, limit, total };
}
