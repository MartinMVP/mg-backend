import { FiscalProvider } from './fiscalProvider.interface';
import {
  FiscalProviderConfig,
  getFiscalProviderConfig,
  toSafeFiscalProviderConfig,
} from './fiscalProvider.config';
import { mockFiscalProvider } from './mockFiscalProvider';

export type FiscalProviderDescriptor = {
  name: string;
  displayName: string;
  enabled: boolean;
  sandbox: boolean;
};

const providerFactories: Record<string, () => FiscalProvider> = {
  mock: () => mockFiscalProvider,
};

const providerCatalog: FiscalProviderDescriptor[] = [
  { name: 'mock', displayName: 'Mock Fiscal Provider', enabled: true, sandbox: true },
  { name: 'future-pac-1', displayName: 'Future PAC Provider 1', enabled: false, sandbox: true },
  { name: 'future-pac-2', displayName: 'Future PAC Provider 2', enabled: false, sandbox: true },
];

export function listFiscalProviders() {
  return providerCatalog.map((provider) => ({ ...provider }));
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
