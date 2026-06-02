import { FiscalProviderConfig, getFiscalProviderConfig } from './fiscalProvider.config';
import { ProviderCredentialShape } from './providerCredentials.types';

export type ProviderSecretStatus = {
  provider: string;
  environment: string;
  hasUsername: boolean;
  hasPassword: boolean;
  hasApiKey: boolean;
  hasToken: boolean;
  hasCertificateRef: boolean;
  hasUsernamePassword: boolean;
  hasCredentials: boolean;
  credentialShape: ProviderCredentialShape;
};

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

export function resolveProviderSecretStatus(
  source: NodeJS.ProcessEnv = process.env,
  config: FiscalProviderConfig = getFiscalProviderConfig(source)
): ProviderSecretStatus {
  const hasUsername = hasValue(source.FISCAL_PROVIDER_SANDBOX_USERNAME);
  const hasPassword = hasValue(source.FISCAL_PROVIDER_SANDBOX_PASSWORD);
  const hasApiKey = hasValue(source.FISCAL_PROVIDER_SANDBOX_API_KEY);
  const hasToken = hasValue(source.FISCAL_PROVIDER_SANDBOX_TOKEN);
  const hasCertificateRef = hasValue(source.FISCAL_PROVIDER_SANDBOX_CERTIFICATE_REF);
  const hasUsernamePassword = hasUsername && hasPassword;

  return {
    provider: config.provider,
    environment: config.environment,
    hasUsername,
    hasPassword,
    hasApiKey,
    hasToken,
    hasCertificateRef,
    hasUsernamePassword,
    hasCredentials: hasUsernamePassword || hasApiKey || hasCertificateRef,
    credentialShape: {
      username: hasUsername,
      password: hasPassword,
      apiKey: hasApiKey,
      token: hasToken,
      certificateReference: hasCertificateRef,
    },
  };
}

export function toSafeProviderSecretStatus(status: ProviderSecretStatus) {
  return {
    provider: status.provider,
    environment: status.environment,
    hasUsername: status.hasUsername,
    hasPassword: status.hasPassword,
    hasApiKey: status.hasApiKey,
    hasToken: status.hasToken,
    hasCertificateRef: status.hasCertificateRef,
    hasUsernamePassword: status.hasUsernamePassword,
    hasCredentials: status.hasCredentials,
  };
}
