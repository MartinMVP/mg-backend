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

export type FacturamaSecretValues = {
  username?: string;
  password?: string;
  apiKey?: string;
};

function hasValue(value: string | undefined) {
  return Boolean(value?.trim());
}

export function resolveProviderSecretStatus(
  source: NodeJS.ProcessEnv = process.env,
  config: FiscalProviderConfig = getFiscalProviderConfig(source)
): ProviderSecretStatus {
  const isFacturama = config.provider === 'facturama';
  const hasUsername = hasValue(isFacturama ? source.FACTURAMA_USERNAME : source.FISCAL_PROVIDER_SANDBOX_USERNAME);
  const hasPassword = hasValue(isFacturama ? source.FACTURAMA_PASSWORD : source.FISCAL_PROVIDER_SANDBOX_PASSWORD);
  const hasApiKey = hasValue(isFacturama ? source.FACTURAMA_API_KEY : source.FISCAL_PROVIDER_SANDBOX_API_KEY);
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

export function resolveFacturamaSecretValues(source: NodeJS.ProcessEnv = process.env): FacturamaSecretValues {
  return {
    username: source.FACTURAMA_USERNAME?.trim() || undefined,
    password: source.FACTURAMA_PASSWORD?.trim() || undefined,
    apiKey: source.FACTURAMA_API_KEY?.trim() || undefined,
  };
}
