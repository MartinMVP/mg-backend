import { FiscalProvider } from './fiscalProvider.interface';
import {
  FiscalProviderConfig,
  getFiscalProviderConfig,
  toSafeFiscalProviderConfig,
} from './fiscalProvider.config';
import { mockFiscalProvider } from './mockFiscalProvider';
import {
  disabledFutureProviderCapabilities,
  mockProviderCapabilities,
  ProviderCapabilities,
} from './providerCapabilities';
import { ProviderHealthResult } from './providerHealth';

export type FiscalProviderDescriptor = {
  name: string;
  displayName: string;
  enabled: boolean;
  sandbox: boolean;
  capabilities: ProviderCapabilities;
};

const providerFactories: Record<string, () => FiscalProvider> = {
  mock: () => mockFiscalProvider,
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

export async function checkFiscalProviderHealth(
  providerName: string,
  config: FiscalProviderConfig = getFiscalProviderConfig()
): Promise<ProviderHealthResult | null> {
  const descriptor = findFiscalProviderDescriptor(providerName);
  if (!descriptor) return null;

  if (!descriptor.enabled || !config.enabled) {
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

  return factory().checkHealth(config.environment);
}

export function resolveFiscalProvider(config: FiscalProviderConfig = getFiscalProviderConfig()) {
  const factory = providerFactories[config.provider];

  if (!config.enabled) {
    throw new Error(`Fiscal provider is disabled: ${config.provider}`);
  }

  if (!factory) {
    throw new Error(`Unsupported fiscal provider: ${config.provider}`);
  }

  return {
    provider: factory(),
    config,
    safeConfig: toSafeFiscalProviderConfig(config),
  };
}
