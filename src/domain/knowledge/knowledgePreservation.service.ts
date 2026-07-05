import { Audit } from '../audit/audit.model';
import { CreateKnowledgeRecordInput, KnowledgeDomain, KnowledgeRecordVersionChanges } from './knowledge.types';
import { createKnowledgeRecord, createKnowledgeRecordVersion } from './knowledgeRecord.service';
import { registerKnowledgeRecord } from './knowledgeRegistry.service';

export async function classifyKnowledgeRecord(input: Pick<CreateKnowledgeRecordInput, 'knowledgeDomain'>) {
  const reusableDomains: KnowledgeDomain[] = ['commercial_listing', 'commercial_transaction'];
  return {
    knowledgeDomain: input.knowledgeDomain,
    contextIsolated: reusableDomains.includes(input.knowledgeDomain),
  };
}

export async function auditKnowledgeAction(action: string, actor = 'system', payload: Record<string, unknown> = {}) {
  return Audit.create({ actor, action, ...(payload as any) });
}

export async function preserveKnowledgeRecord(record: any, producer?: string, actorId?: string) {
  return registerKnowledgeRecord({ record, producer, actorId });
}

export async function captureKnowledgeRecord(input: CreateKnowledgeRecordInput & { actorId?: string }) {
  await classifyKnowledgeRecord(input);
  return createKnowledgeRecord(input);
}

export async function versionKnowledgeRecord(
  recordId: string,
  changes: KnowledgeRecordVersionChanges,
  actorId?: string
) {
  return createKnowledgeRecordVersion({ previousRecordId: recordId, changes, actorId });
}
