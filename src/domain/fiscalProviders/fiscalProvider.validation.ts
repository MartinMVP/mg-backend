import { FiscalProviderConfig } from './fiscalProvider.config';
import { findFiscalProviderDescriptor } from './fiscalProvider.registry';

export type FiscalProviderConfigValidation = {
  valid: boolean;
  issues: string[];
  provider: string;
  environment: string;
};

const allowedEnvironments = ['mock', 'sandbox', 'production'];
const MIN_TIMEOUT_MS = 100;
const MAX_TIMEOUT_MS = 60_000;

export function validateFiscalProviderConfig(config: FiscalProviderConfig): FiscalProviderConfigValidation {
  const issues: string[] = [];
  const descriptor = findFiscalProviderDescriptor(config.provider);

  if (!descriptor) {
    issues.push('provider_not_registered');
  } else if (!descriptor.enabled && config.provider !== 'sandbox-pac' && config.provider !== 'facturama') {
    issues.push('provider_disabled');
  }

  if (!config.enabled) {
    issues.push('provider_config_disabled');
  }

  if (!allowedEnvironments.includes(config.environment)) {
    issues.push('invalid_environment');
  }

  if (config.environment === 'production' && config.sandbox) {
    issues.push('production_cannot_use_sandbox');
  }

  if (config.environment !== 'production' && !config.sandbox) {
    issues.push('non_production_requires_sandbox');
  }

  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < MIN_TIMEOUT_MS || config.timeoutMs > MAX_TIMEOUT_MS) {
    issues.push('invalid_timeout');
  }

  if (config.provider === 'mock' && config.apiUrl) {
    issues.push('mock_provider_does_not_use_api_url');
  }

  if (config.provider === 'sandbox-pac') {
    if (!config.enabled) {
      issues.push('sandbox_provider_disabled');
    }

    if (config.environment !== 'sandbox') {
      issues.push('invalid_provider_environment');
      issues.push('sandbox_environment_invalid');
    }

    if (!config.apiUrl) {
      issues.push('missing_sandbox_api_url');
      issues.push('sandbox_api_url_missing');
    }

    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < MIN_TIMEOUT_MS || config.timeoutMs > MAX_TIMEOUT_MS) {
      issues.push('sandbox_timeout_invalid');
    }
  }

  if (config.provider === 'facturama') {
    if (!config.enabled) {
      issues.push('facturama_provider_disabled');
    }

    if (config.environment !== 'sandbox') {
      issues.push('invalid_provider_environment');
      issues.push('facturama_environment_invalid');
    }

    if (!config.apiUrl) {
      issues.push('missing_facturama_api_url');
      issues.push('facturama_api_url_missing');
    }

    issues.push('facturama_integration_disabled');
  }

  return {
    valid: issues.length === 0,
    issues,
    provider: config.provider,
    environment: config.environment,
  };
}
