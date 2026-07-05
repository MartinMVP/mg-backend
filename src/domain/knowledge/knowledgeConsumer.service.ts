import {
  KnowledgeConsumerContract,
  knowledgeAssetTypes,
  knowledgeConsumerTypes,
  knowledgeDomains,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
} from './knowledge.types';
import { KnowledgeConsumer } from './knowledgeConsumer.model';

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

export function validateKnowledgeConsumerContract(input: KnowledgeConsumerContract) {
  if (!knowledgeConsumerTypes.includes(input.consumerType)) reject(400, 'invalid_consumer_type');
  if (!input.ownerDomain) reject(400, 'owner_domain_required');
  if (!input.steward) reject(400, 'steward_required');
  if (!input.purposeCategory) reject(400, 'purpose_category_required');
  if (!input.allowedDomains?.length || input.allowedDomains.some((domain) => !knowledgeDomains.includes(domain as any))) {
    reject(400, 'allowed_domains_required');
  }
  if (!input.allowedAssetTypes?.length || input.allowedAssetTypes.some((type) => !knowledgeAssetTypes.includes(type as any))) {
    reject(400, 'allowed_asset_types_required');
  }
  if (!knowledgeQualityLevels.includes(input.minimumKnowledgeQuality)) reject(400, 'invalid_minimum_quality');
  if (!input.preferredLifecycle?.length || input.preferredLifecycle.some((stage) => !knowledgeLifecycleStages.includes(stage))) {
    reject(400, 'preferred_lifecycle_required');
  }
  return true;
}

export async function createKnowledgeConsumer(input: KnowledgeConsumerContract) {
  validateKnowledgeConsumerContract(input);
  return KnowledgeConsumer.create(input);
}

export async function countKnowledgeConsumers() {
  return KnowledgeConsumer.countDocuments();
}
