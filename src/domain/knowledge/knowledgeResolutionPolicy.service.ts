import {
  KnowledgeResolutionPolicyInput,
  knowledgeDomains,
  knowledgeLifecycleStages,
  knowledgeQualityLevels,
} from './knowledge.types';
import { KnowledgeResolutionPolicy } from './knowledgeResolutionPolicy.model';

function reject(status: number, message: string): never {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  throw error;
}

export function validateKnowledgeResolutionPolicy(input: KnowledgeResolutionPolicyInput) {
  if (!input.allowedDomains?.length || input.allowedDomains.some((domain) => !knowledgeDomains.includes(domain as any))) {
    reject(400, 'policy_allowed_domains_required');
  }
  if (!knowledgeQualityLevels.includes(input.minimumQuality)) reject(400, 'policy_minimum_quality_invalid');
  if (!input.allowedLifecycle?.length || input.allowedLifecycle.some((stage) => !knowledgeLifecycleStages.includes(stage))) {
    reject(400, 'policy_allowed_lifecycle_required');
  }
  if (!Number.isFinite(input.maximumPackageSize) || input.maximumPackageSize < 1 || input.maximumPackageSize > 100) {
    reject(400, 'policy_maximum_package_size_invalid');
  }
  return true;
}

export async function createKnowledgeResolutionPolicy(input: KnowledgeResolutionPolicyInput) {
  validateKnowledgeResolutionPolicy(input);
  return KnowledgeResolutionPolicy.create(input);
}
