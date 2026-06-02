export type ProviderEnvironment = 'local' | 'sandbox' | 'production';

export type ProviderEnvironmentRules = {
  environment: ProviderEnvironment;
  sandbox: boolean;
  allowsExternalCalls: boolean;
  allowsRealCredentials: boolean;
};

export const providerEnvironmentRules: Record<ProviderEnvironment, ProviderEnvironmentRules> = {
  local: {
    environment: 'local',
    sandbox: true,
    allowsExternalCalls: false,
    allowsRealCredentials: false,
  },
  sandbox: {
    environment: 'sandbox',
    sandbox: true,
    allowsExternalCalls: false,
    allowsRealCredentials: false,
  },
  production: {
    environment: 'production',
    sandbox: false,
    allowsExternalCalls: false,
    allowsRealCredentials: false,
  },
};

export function normalizeProviderEnvironment(environment: string): ProviderEnvironment | null {
  if (environment === 'mock' || environment === 'local') return 'local';
  if (environment === 'sandbox' || environment === 'production') return environment;

  return null;
}

export function getProviderEnvironmentRules(environment: string) {
  const normalized = normalizeProviderEnvironment(environment);
  if (!normalized) return null;

  return providerEnvironmentRules[normalized];
}
