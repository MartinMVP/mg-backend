import { FiscalProvider } from './fiscalProvider.interface';
import {
  FiscalProviderConfig,
  getFiscalProviderConfig,
  toSafeFiscalProviderConfig,
} from './fiscalProvider.config';
import { mockFiscalProvider } from './mockFiscalProvider';
import { SandboxFiscalProvider } from './sandboxFiscalProvider';
import {
  disabledFutureProviderCapabilities,
  mockProviderCapabilities,
  ProviderCapabilities,
  sandboxPacProviderCapabilities,
} from './providerCapabilities';
import { ProviderHealthResult } from './providerHealth';
import { resolveProviderSecretStatus } from './providerSecret.resolver';

export type FiscalProviderDescriptor = {
  name: string;
  displayName: string;
  enabled: boolean;
  sandbox: boolean;
  capabilities: ProviderCapabilities;
};

type ProviderFactory = (config: FiscalProviderConfig) => FiscalProvider;

function getSandboxPacReadinessIssues(config: FiscalProviderConfig) {
  const issues: string[] = [];
  const secrets = resolveProviderSecretStatus(process.env, config);

  if (config.provider !== 'sandbox-pac') issues.push('invalid_provider');
  if (!config.enabled) issues.push('provider_config_disabled');
  if (config.environment !== 'sandbox') issues.push('sandbox_environment_invalid');
  if (!config.sandbox) issues.push('sandbox_flag_required');
  if (!config.apiUrl) issues.push('missing_sandbox_api_url');
  if (!secrets.hasCredentials) issues.push('sandbox_credentials_missing');

  return [...new Set(issues)];
}

const providerFactories: Record<string, ProviderFactory> = {
  mock: () => mockFiscalProvider,
  'sandbox-pac': (config) => new SandboxFiscalProvider({
    config,
    readinessIssues: getSandboxPacReadinessIssues(config),
  }),
};

const providerCatalog: FiscalProviderDescriptor[] = [
  {
    name: 'mock',
    displayName: 'Mock Fiscal Provider',
    enabled: true,
    sandbox: true,
    capabilities: mockProviderCapabilities,
  },
  {
    name: 'future-pac-1',
    displayName: 'Future PAC Provider 1',
    enabled: false,
    sandbox: true,
    capabilities: disabledFutureProviderCapabilities,
  },
  {
    name: 'future-pac-2',
    displayName: 'Future PAC Provider 2',
    enabled: false,
    sandbox: true,
    capabilities: disabledFutureProviderCapabilities,
  },
  {
    name: 'sandbox-pac',
    displayName: 'Sandbox PAC Provider Placeholder',
    enabled: false,
    sandbox: true,
    capabilities: sandboxPacProviderCapabilities,
  },
];

export function listFiscalProviders() {
  return providerCatalog.map((provider) => ({ ...provider }));
}

export function findFiscalProviderDescriptor(providerName: string) {
  return providerCatalog.find((provider) => provider.name === providerName) || null;
}

export function getFiscalProviderCapabilities(providerName: string) {
  const descriptor = findFiscalProviderDescriptor(providerName);
  if (!descriptor) return null;

  return {
    provider: descriptor.name,
    enabled: descriptor.enabled,
    capabilities: { ...descriptor.capabilities },
  };
}

export function hasFiscalProviderFactory(providerName: string) {
  return Boolean(providerFactories[providerName]);
}

export async function checkFiscalProviderHealth(
  providerName: string,
  config: FiscalProviderConfig = getFiscalProviderConfig()
): Promise<ProviderHealthResult | null> {
  const descriptor = findFiscalProviderDescriptor(providerName);
  if (!descriptor) return null;

  const enabled = providerName === 'sandbox-pac'
    ? config.enabled
    : descriptor.enabled && config.enabled;

  if (!enabled) {
    return {
      ok: false,
      provider: descriptor.name,
      environment: config.environment,
      status: 'disabled',
      message: 'Fiscal provider is disabled',
      checkedAt: new Date(),
    };
  }

  const factory = providerFactories[providerName];
  if (!factory) {
    return {
      ok: false,
      provider: descriptor.name,
      environment: config.environment,
      status: 'disabled',
      message: 'Fiscal provider implementation is not available',
      checkedAt: new Date(),
    };
  }

  return factory(config).checkHealth(config.environment);
}

export function resolveFiscalProvider(config: FiscalProviderConfig = getFiscalProviderConfig()) {
  const factory = providerFactories[config.provider];

  if (!config.enabled) {
    throw new Error(`Fiscal provider is disabled: ${config.provider}`);
  }

  if (!factory) {
    throw new Error(`Unsupported fiscal provider: ${config.provider}`);
  }

  if (config.provider === 'sandbox-pac') {
    const issues = getSandboxPacReadinessIssues(config);
    if (issues.length > 0) {
      throw new Error(`Sandbox fiscal provider is not ready: ${issues.join(',')}`);
    }
  }

  return {
    provider: factory(config),
    config,
    safeConfig: toSafeFiscalProviderConfig(config),
  };
}
