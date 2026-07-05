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

export const knowledgeCollectionTypes = [
  'case',
  'pattern',
  'incident',
  'investigation',
  'workflow',
  'operational_history',
] as const;
export type KnowledgeCollectionType = typeof knowledgeCollectionTypes[number];

export const knowledgeAssetTypes = [
  'operational_pattern',
  'business_pattern',
  'compliance_pattern',
  'platform_pattern',
  'engineering_pattern',
] as const;
export type KnowledgeAssetType = typeof knowledgeAssetTypes[number];

export const knowledgeQualityLevels = ['candidate', 'observed', 'validated', 'trusted', 'authoritative'] as const;
export type KnowledgeQualityLevel = typeof knowledgeQualityLevels[number];

export const knowledgeLifecycleStages = ['candidate', 'validated', 'approved', 'reusable', 'deprecated', 'archived'] as const;
export type KnowledgeLifecycleStage = typeof knowledgeLifecycleStages[number];

export const knowledgeRegistryStatuses = ['active', 'deprecated', 'archived'] as const;
export type KnowledgeRegistryStatus = typeof knowledgeRegistryStatuses[number];

export const knowledgeConsumerTypes = ['aoe', 'analytics', 'quality', 'admin'] as const;
export type KnowledgeConsumerType = typeof knowledgeConsumerTypes[number];

export interface KnowledgeConsumerContract {
  consumerType: KnowledgeConsumerType;
  ownerDomain: string;
  steward: string;
  allowedDomains: string[];
  allowedAssetTypes: string[];
  minimumKnowledgeQuality: KnowledgeQualityLevel;
  maximumKnowledgeAge?: number | null;
  preferredLifecycle: KnowledgeLifecycleStage[];
  purposeCategory: string;
}

export interface KnowledgeResolutionPolicyInput {
  allowedDomains: string[];
  minimumQuality: KnowledgeQualityLevel;
  allowedLifecycle: KnowledgeLifecycleStage[];
  maximumPackageSize: number;
  includeDeprecated: boolean;
  includeCandidate: boolean;
}

export interface KnowledgeQuality {
  level: KnowledgeQualityLevel;
  score: number;
  rationale: string;
  evaluatedAt: Date;
}

export interface KnowledgeLifecycle {
  stage: KnowledgeLifecycleStage;
  enteredAt: Date;
  updatedAt: Date;
  reason?: string | null;
}

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

export interface CreateKnowledgeCollectionInput {
  tenantId?: string;
  collectionType: KnowledgeCollectionType;
  title: string;
  description: string;
  knowledgeRecords: Types.ObjectId[] | string[];
  ownerDomain: string;
  knowledgeSteward: string;
  metadata?: Record<string, unknown>;
}

export interface CreateKnowledgeAssetInput {
  tenantId?: string;
  assetType: KnowledgeAssetType;
  title: string;
  description: string;
  collections: Types.ObjectId[] | string[];
  domain: string;
  ownerDomain: string;
  knowledgeSteward: string;
  quality?: KnowledgeQuality;
  lifecycle?: KnowledgeLifecycle;
  version?: number;
}
