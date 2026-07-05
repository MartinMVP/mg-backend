import { Audit } from '../audit/audit.model';
import {
  CreateKnowledgeAssetInput,
  CreateKnowledgeCollectionInput,
  CreateKnowledgeRecordInput,
  KnowledgeDomain,
  KnowledgeRecordVersionChanges,
} from './knowledge.types';
import { createKnowledgeAsset } from './knowledgeAsset.service';
import { createKnowledgeCollection } from './knowledgeCollection.service';
import { createKnowledgeRecord, createKnowledgeRecordVersion } from './knowledgeRecord.service';
import { registerKnowledgeRecord } from './knowledgeRegistry.service';
import { resolveKnowledge } from './knowledgeResolution.service';

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

export async function organizeKnowledge(input: CreateKnowledgeCollectionInput & { actorId?: string }) {
  return createKnowledgeCollection(input);
}

export async function governKnowledge(input: CreateKnowledgeAssetInput & { actorId?: string }) {
  return createKnowledgeAsset(input);
}

export async function curateKnowledge(input: CreateKnowledgeAssetInput & { actorId?: string }) {
  return createKnowledgeAsset(input);
}

export async function reviewKnowledge(input: {
  subjectId: string;
  subjectType: 'record' | 'collection' | 'asset';
  reviewer: string;
  notes?: string;
}) {
  await auditKnowledgeAction('KNOWLEDGE_REVIEW_RECORDED', input.reviewer, input);
  return {
    reviewed: true,
    subjectId: input.subjectId,
    subjectType: input.subjectType,
    reviewer: input.reviewer,
  };
}

export async function utilizeKnowledge(input: Parameters<typeof resolveKnowledge>[0]) {
  return resolveKnowledge(input);
}

export async function observeKnowledge(input: {
  packageId: string;
  observer: string;
  notes?: string;
}) {
  await auditKnowledgeAction('KNOWLEDGE_UTILIZATION_OBSERVED', input.observer, input);
  return { observed: true, packageId: input.packageId, observer: input.observer };
}
