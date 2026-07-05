import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { KnowledgeAsset, IKnowledgeAsset } from './knowledgeAsset.model';
import { KnowledgeCollection } from './knowledgeCollection.model';
import { KnowledgeConsumer } from './knowledgeConsumer.model';
import { KnowledgeExplainability } from './knowledgeExplainability.model';
import { KnowledgeRecord } from './knowledgeRecord.model';
import { KnowledgeSnapshot } from './knowledgeSnapshot.model';
import { KnowledgeUtilizationContext } from './knowledgeUtilizationContext.model';
import { KnowledgeUtilizationPackage } from './knowledgeUtilizationPackage.model';
import {
  KnowledgeConsumerContract,
  KnowledgeLifecycleStage,
  KnowledgeQualityLevel,
  KnowledgeResolutionPolicyInput,
} from './knowledge.types';
import { validateKnowledgeConsumerContract } from './knowledgeConsumer.service';
import { validateKnowledgeResolutionPolicy } from './knowledgeResolutionPolicy.service';

export const knowledgeUtilizationAuditActions = {
  consumed: 'KNOWLEDGE_CONSUMED',
  packageGenerated: 'KNOWLEDGE_PACKAGE_GENERATED',
  packageAccessed: 'KNOWLEDGE_PACKAGE_ACCESSED',
  resolutionExecuted: 'KNOWLEDGE_RESOLUTION_EXECUTED',
  snapshotCreated: 'KNOWLEDGE_SNAPSHOT_CREATED',
} as const;

const qualityRank: Record<KnowledgeQualityLevel, number> = {
  candidate: 1,
  observed: 2,
  validated: 3,
  trusted: 4,
  authoritative: 5,
};

const lifecycleRank: Record<KnowledgeLifecycleStage, number> = {
  candidate: 1,
  validated: 2,
  approved: 3,
  reusable: 4,
  deprecated: 0,
  archived: -1,
};

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, ...(payload as any) });
}

export function validatePolicy(policy: KnowledgeResolutionPolicyInput) {
  return validateKnowledgeResolutionPolicy(policy);
}

export async function validateConsumer(consumer: KnowledgeConsumerContract) {
  validateKnowledgeConsumerContract(consumer);
  const saved = await KnowledgeConsumer.findOne({
    consumerType: consumer.consumerType,
    ownerDomain: consumer.ownerDomain,
    purposeCategory: consumer.purposeCategory,
  });
  return saved || KnowledgeConsumer.create(consumer);
}

function withinAge(asset: IKnowledgeAsset, maximumKnowledgeAge?: number | null) {
  if (!maximumKnowledgeAge) return true;
  const ageMs = Date.now() - new Date(asset.createdAt).getTime();
  return ageMs <= maximumKnowledgeAge * 24 * 60 * 60_000;
}

export function determineEligibility(input: {
  assets: Array<IKnowledgeAsset & { _id: Types.ObjectId }>;
  consumer: KnowledgeConsumerContract;
  policy: KnowledgeResolutionPolicyInput;
}) {
  const excludedByRules: Array<{ assetId: string; reason: string }> = [];
  const eligible = input.assets.filter((asset) => {
    const assetId = String(asset._id);
    if (!input.consumer.allowedDomains.includes(asset.domain) || !input.policy.allowedDomains.includes(asset.domain)) {
      excludedByRules.push({ assetId, reason: 'domain_not_allowed' });
      return false;
    }
    if (!input.consumer.allowedAssetTypes.includes(asset.assetType)) {
      excludedByRules.push({ assetId, reason: 'asset_type_not_allowed' });
      return false;
    }
    if (qualityRank[asset.quality.level] < qualityRank[input.consumer.minimumKnowledgeQuality]) {
      excludedByRules.push({ assetId, reason: 'consumer_minimum_quality_not_met' });
      return false;
    }
    if (qualityRank[asset.quality.level] < qualityRank[input.policy.minimumQuality]) {
      excludedByRules.push({ assetId, reason: 'policy_minimum_quality_not_met' });
      return false;
    }
    if (!input.policy.allowedLifecycle.includes(asset.lifecycle.stage)) {
      excludedByRules.push({ assetId, reason: 'lifecycle_not_allowed' });
      return false;
    }
    if (!input.policy.includeDeprecated && asset.lifecycle.stage === 'deprecated') {
      excludedByRules.push({ assetId, reason: 'deprecated_excluded' });
      return false;
    }
    if (!input.policy.includeCandidate && asset.lifecycle.stage === 'candidate') {
      excludedByRules.push({ assetId, reason: 'candidate_excluded' });
      return false;
    }
    if (!withinAge(asset, input.consumer.maximumKnowledgeAge)) {
      excludedByRules.push({ assetId, reason: 'knowledge_too_old' });
      return false;
    }
    return true;
  });
  return { eligible, excludedByRules };
}

export function rankKnowledge(assets: Array<IKnowledgeAsset & { _id: Types.ObjectId }>, consumer: KnowledgeConsumerContract) {
  return [...assets].sort((a, b) => {
    const qualityDelta = qualityRank[b.quality.level] - qualityRank[a.quality.level];
    if (qualityDelta) return qualityDelta;
    const lifecycleDelta = lifecycleRank[b.lifecycle.stage] - lifecycleRank[a.lifecycle.stage];
    if (lifecycleDelta) return lifecycleDelta;
    const freshnessDelta = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (freshnessDelta) return freshnessDelta;
    const domainDelta = Number(b.domain === consumer.ownerDomain) - Number(a.domain === consumer.ownerDomain);
    if (domainDelta) return domainDelta;
    const stewardDelta = Number(b.knowledgeSteward === consumer.steward) - Number(a.knowledgeSteward === consumer.steward);
    if (stewardDelta) return stewardDelta;
    if (b.version !== a.version) return b.version - a.version;
    return String(a._id).localeCompare(String(b._id));
  });
}

export function selectKnowledge(
  ranked: Array<IKnowledgeAsset & { _id: Types.ObjectId }>,
  policy: KnowledgeResolutionPolicyInput
) {
  return ranked.slice(0, policy.maximumPackageSize);
}

export async function assemblePackage(input: {
  tenantId?: string;
  consumer: KnowledgeConsumerContract;
  policy: KnowledgeResolutionPolicyInput;
  selectedAssets: Array<IKnowledgeAsset & { _id: Types.ObjectId }>;
  discardedAssets: Array<IKnowledgeAsset & { _id: Types.ObjectId }>;
  excludedByRules: Array<{ assetId?: string; reason: string }>;
  domain: string;
  objective: string;
  constraints?: Record<string, unknown>;
  requestedKnowledge?: Record<string, unknown>;
}) {
  const generatedAt = new Date();
  const collectionIds = [...new Set(input.selectedAssets.flatMap((asset) => asset.collections.map(String)))].map((id) => new Types.ObjectId(id));
  const collections = await KnowledgeCollection.find({ _id: { $in: collectionIds } }).lean();
  const recordIds = [...new Set(collections.flatMap((collection) => collection.knowledgeRecords.map(String)))].map((id) => new Types.ObjectId(id));
  const records = await KnowledgeRecord.find({ _id: { $in: recordIds } }).select('_id version').lean();

  const context = await KnowledgeUtilizationContext.create({
    consumer: input.consumer,
    domain: input.domain,
    objective: input.objective,
    constraints: input.constraints || {},
    requestedKnowledge: input.requestedKnowledge || {},
    generatedAt,
  });

  const explainability = await KnowledgeExplainability.create({
    selectedAssets: input.selectedAssets.map((asset) => asset._id),
    discardedAssets: input.discardedAssets.map((asset) => asset._id),
    appliedPolicies: [input.policy],
    excludedByRules: input.excludedByRules,
  });

  const pkg = await KnowledgeUtilizationPackage.create({
    tenantId: input.tenantId || 'default',
    context: context.toObject(),
    records: records.map((record) => record._id),
    collections: collections.map((collection) => collection._id),
    assets: input.selectedAssets.map((asset) => asset._id),
    provenance: {
      resolution: 'deterministic_policy_orchestration',
      contextId: context._id,
      explainabilityId: explainability._id,
    },
    quality: {
      minimumQuality: input.policy.minimumQuality,
      selectedQualityLevels: input.selectedAssets.map((asset) => asset.quality.level),
    },
    explainability: explainability.toObject(),
    generatedAt,
  });

  const versions = Object.fromEntries([
    ...records.map((record) => [`record:${String(record._id)}`, record.version]),
    ...collections.map((collection: any) => [`collection:${String(collection._id)}`, 1]),
    ...input.selectedAssets.map((asset) => [`asset:${String(asset._id)}`, asset.version]),
  ]);

  const snapshot = await KnowledgeSnapshot.create({
    tenantId: input.tenantId || 'default',
    packageId: pkg._id,
    records: records.map((record) => record._id),
    collections: collections.map((collection) => collection._id),
    assets: input.selectedAssets.map((asset) => asset._id),
    versions,
    generatedAt,
  });

  return { package: pkg.toObject(), snapshot: snapshot.toObject(), explainability: explainability.toObject() };
}

export async function resolveKnowledge(input: {
  consumer: KnowledgeConsumerContract;
  policy: KnowledgeResolutionPolicyInput;
  domain: string;
  objective: string;
  constraints?: Record<string, unknown>;
  requestedKnowledge?: Record<string, unknown>;
  tenantId?: string;
  actorId?: string;
}) {
  validatePolicy(input.policy);
  await validateConsumer(input.consumer);

  const assets = await KnowledgeAsset.find({ tenantId: input.tenantId || 'default' }).lean();
  const { eligible, excludedByRules } = determineEligibility({ assets: assets as any, consumer: input.consumer, policy: input.policy });
  const ranked = rankKnowledge(eligible as any, input.consumer);
  const selectedAssets = selectKnowledge(ranked as any, input.policy);
  const discardedAssets = ranked.slice(selectedAssets.length);
  const assembled = await assemblePackage({
    ...input,
    selectedAssets: selectedAssets as any,
    discardedAssets: discardedAssets as any,
    excludedByRules,
  });

  await audit(input.actorId || 'system', knowledgeUtilizationAuditActions.resolutionExecuted, {
    packageId: assembled.package._id,
  });
  await audit(input.actorId || 'system', knowledgeUtilizationAuditActions.packageGenerated, {
    packageId: assembled.package._id,
  });
  await audit(input.actorId || 'system', knowledgeUtilizationAuditActions.snapshotCreated, {
    packageId: assembled.package._id,
    snapshotId: assembled.snapshot._id,
  });
  await audit(input.actorId || 'system', knowledgeUtilizationAuditActions.consumed, {
    consumerType: input.consumer.consumerType,
    packageId: assembled.package._id,
  });

  return assembled;
}

export async function getKnowledgeUtilizationPackage(id: string, actorId?: string) {
  if (!Types.ObjectId.isValid(id)) reject(400, 'invalid_object_id');
  const pkg = await KnowledgeUtilizationPackage.findById(id).lean();
  if (!pkg) reject(404, 'knowledge_package_not_found');
  await audit(actorId || 'system', knowledgeUtilizationAuditActions.packageAccessed, { packageId: pkg._id });
  return pkg;
}

export async function getKnowledgeSnapshot(id: string) {
  if (!Types.ObjectId.isValid(id)) reject(400, 'invalid_object_id');
  const snapshot = await KnowledgeSnapshot.findById(id).lean();
  if (!snapshot) reject(404, 'knowledge_snapshot_not_found');
  return snapshot;
}
