import {
  getProviderCredentialContract,
  ProviderCredentialField,
  ProviderCredentialShape,
} from './providerCredentials.types';
import { FiscalProviderConfig } from './fiscalProvider.config';
import { getProviderEnvironmentRules } from './providerEnvironment';

export type ProviderSecretValidationResult = {
  valid: boolean;
  issues: string[];
  provider: string;
  environment: string;
};

const credentialFields: ProviderCredentialField[] = [
  'username',
  'password',
  'apiKey',
  'token',
  'certificateReference',
];

export function validateProviderSecretStructure(
  config: FiscalProviderConfig,
  credentialShape: ProviderCredentialShape = {}
): ProviderSecretValidationResult {
  const issues: string[] = [];
  const environmentRules = getProviderEnvironmentRules(config.environment);
  const contract = getProviderCredentialContract(config.provider, config.environment);

  if (!environmentRules) {
    issues.push('invalid_provider_environment');
  } else if (environmentRules.environment === 'production' && config.sandbox) {
    issues.push('production_cannot_use_sandbox');
  }

  for (const field of Object.keys(credentialShape)) {
    if (!credentialFields.includes(field as ProviderCredentialField)) {
      issues.push('unsupported_credential_field');
      break;
    }
  }

  for (const field of contract.requiredFields) {
    if (!credentialShape[field]) {
      issues.push(`missing_${field}`);
    }
  }

  if (config.provider === 'mock' && Object.values(credentialShape).some(Boolean)) {
    issues.push('mock_provider_must_not_receive_credentials');
  }

  return {
    valid: issues.length === 0,
    issues,
    provider: config.provider,
    environment: config.environment,
  };
}
