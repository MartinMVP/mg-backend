import { Types } from 'mongoose';

export const knowledgeDomains = [
  'operational',
  'commercial_listing',
  'commercial_transaction',
  'membership',
  'revenue',
  'compliance',
  'fiscal',
  'platform',
  'engineering',
  'ai',
  'customer',
] as const;
export type KnowledgeDomain = typeof knowledgeDomains[number];

export const knowledgeSourceTypes = [
  'audit',
  'analytics',
  'quality',
  'aoe_operational_decision',
  'human_review',
  'outcome',
  'system',
  'manual',
] as const;
export type KnowledgeSourceType = typeof knowledgeSourceTypes[number];

export const knowledgeGeneratedBy = ['system', 'admin', 'aoe', 'human_review', 'import', 'manual'] as const;
export type KnowledgeGeneratedBy = typeof knowledgeGeneratedBy[number];

export const knowledgeStorageTypes = [
  'mongodb',
  'external',
  'document',
  'future_graph',
  'future_vector',
  'future_ai_memory',
] as const;
export type KnowledgeStorageType = typeof knowledgeStorageTypes[number];

export interface KnowledgeSourceEvidence {
  sourceType: KnowledgeSourceType;
  sourceId?: Types.ObjectId | string | null;
  description: string;
}

export interface KnowledgeProvenance {
  generatedBy: KnowledgeGeneratedBy;
  sourceEvidence: KnowledgeSourceEvidence[];
  rulesVersion?: string | null;
  engineVersion?: string | null;
  validatedBy?: Types.ObjectId | null;
  approvedBy?: Types.ObjectId | null;
  createdAt: Date;
  validatedAt?: Date | null;
  approvedAt?: Date | null;
}

export interface KnowledgeLocation {
  storageType: KnowledgeStorageType;
  reference: string;
}

export interface CreateKnowledgeRecordInput {
  knowledgeDomain: KnowledgeDomain;
  knowledgeType: string;
  sourceType: KnowledgeSourceType;
  sourceId?: Types.ObjectId | string | null;
  facts: Record<string, unknown>;
  context?: Record<string, unknown>;
  provenance: Omit<KnowledgeProvenance, 'createdAt'> & { createdAt?: Date };
  version?: number;
  producer?: string;
}

export interface KnowledgeRecordVersionChanges {
  facts?: Record<string, unknown>;
  context?: Record<string, unknown>;
  knowledgeType?: string;
  sourceType?: KnowledgeSourceType;
  sourceId?: Types.ObjectId | string | null;
  provenance?: Partial<KnowledgeProvenance>;
  producer?: string;
}
