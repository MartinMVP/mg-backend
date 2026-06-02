import { FiscalProviderConfig, getFiscalProviderConfig, toSafeFiscalProviderConfig } from './fiscalProvider.config';
import { validateFiscalProviderConfig } from './fiscalProvider.validation';
import {
  findFiscalProviderDescriptor,
  checkFiscalProviderHealth,
  hasFiscalProviderFactory,
} from './fiscalProvider.registry';
import { getProviderCredentialContract, toSafeCredentialContract } from './providerCredentials.types';
import { getProviderEnvironmentRules } from './providerEnvironment';
import { validateProviderSecretStructure } from './providerSecret.validation';
import { resolveProviderSecretStatus, toSafeProviderSecretStatus } from './providerSecret.resolver';
import {
  defaultProviderResilienceConfig,
  validateProviderResilienceConfig,
} from './providerResilience.types';

export type ResolvedProviderConfiguration = {
  provider: string;
  environment: string;
  normalizedEnvironment: string | null;
  enabled: boolean;
  safeConfig: ReturnType<typeof toSafeFiscalProviderConfig>;
  capabilities: unknown;
  environmentRules: ReturnType<typeof getProviderEnvironmentRules>;
  credentialContract: ReturnType<typeof toSafeCredentialContract>;
  secretStatus: ReturnType<typeof toSafeProviderSecretStatus>;
  resilience: typeof defaultProviderResilienceConfig;
  configValidation: ReturnType<typeof validateFiscalProviderConfig>;
  credentialValidation: ReturnType<typeof validateProviderSecretStructure>;
  resilienceValidation: ReturnType<typeof validateProviderResilienceConfig>;
};

export type ProviderReadinessResult = {
  ready: boolean;
  issues: string[];
  provider: string;
  environment: string;
};

export function resolveProviderConfiguration(
  config: FiscalProviderConfig = getFiscalProviderConfig()
): ResolvedProviderConfiguration {
  const descriptor = findFiscalProviderDescriptor(config.provider);
  const environmentRules = getProviderEnvironmentRules(config.environment);
  const credentialContract = getProviderCredentialContract(config.provider, config.environment);
  const secretStatus = resolveProviderSecretStatus(process.env, config);
  const resilience = {
    ...defaultProviderResilienceConfig,
    timeoutMs: config.timeoutMs,
    maxRetries: config.maxRetries,
    retryBackoffMs: config.retryBackoffMs,
    circuitBreakerEnabled: config.circuitBreakerEnabled,
    failureThreshold: config.failureThreshold,
    resetTimeoutMs: config.resetTimeoutMs,
    maxPayloadBytes: config.maxPayloadBytes,
    maxProviderPayloadBytes: config.maxProviderPayloadBytes,
  };

  const enabled = config.provider === 'sandbox-pac'
    ? config.enabled
    : config.enabled && Boolean(descriptor?.enabled);

  return {
    provider: config.provider,
    environment: config.environment,
    normalizedEnvironment: environmentRules?.environment || null,
    enabled,
    safeConfig: toSafeFiscalProviderConfig(config),
    capabilities: descriptor?.capabilities || null,
    environmentRules,
    credentialContract: toSafeCredentialContract(credentialContract),
    secretStatus: toSafeProviderSecretStatus(secretStatus),
    resilience,
    configValidation: validateFiscalProviderConfig(config),
    credentialValidation: validateProviderSecretStructure(config, secretStatus.credentialShape),
    resilienceValidation: validateProviderResilienceConfig(resilience),
  };
}

export async function evaluateProviderReadiness(
  config: FiscalProviderConfig = getFiscalProviderConfig()
): Promise<ProviderReadinessResult> {
  const issues: string[] = [];
  const resolved = resolveProviderConfiguration(config);
  const descriptor = findFiscalProviderDescriptor(config.provider);

  if (!descriptor) {
    issues.push('provider_not_registered');
  } else if (!descriptor.enabled && config.provider !== 'sandbox-pac') {
    issues.push('provider_disabled');
  }

  if (!config.enabled) {
    issues.push('provider_config_disabled');
  }

  if (!resolved.environmentRules) {
    issues.push('invalid_provider_environment');
  }

  if (!resolved.capabilities) {
    issues.push('provider_capabilities_missing');
  }

  if (descriptor && !hasFiscalProviderFactory(config.provider)) {
    issues.push('provider_not_resolvable');
  }

  issues.push(...resolved.configValidation.issues);
  issues.push(...resolved.credentialValidation.issues);
  issues.push(...resolved.resilienceValidation.issues);

  const health = await checkFiscalProviderHealth(config.provider, config);
  if (!health) {
    issues.push('provider_health_missing');
  } else if (!health.ok) {
    issues.push(`provider_health_${health.status}`);
  }

  return {
    ready: issues.length === 0,
    issues: [...new Set(issues)],
    provider: config.provider,
    environment: config.environment,
  };
}
