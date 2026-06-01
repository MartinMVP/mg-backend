export type FiscalProviderConfig = {
  provider: string;
  environment: string;
  enabled: boolean;
  sandbox: boolean;
  apiUrl: string | null;
  timeoutMs: number;
};

function parseBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseTimeout(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

export function getFiscalProviderConfig(source: NodeJS.ProcessEnv = process.env): FiscalProviderConfig {
  const provider = source.FISCAL_PROVIDER?.trim() || 'mock';
  const environment = source.FISCAL_PROVIDER_ENVIRONMENT?.trim() || (provider === 'mock' ? 'mock' : 'sandbox');

  return {
    provider,
    environment,
    enabled: parseBool(source.FISCAL_PROVIDER_ENABLED, true),
    sandbox: parseBool(source.FISCAL_PROVIDER_SANDBOX, environment !== 'production'),
    apiUrl: source.FISCAL_PROVIDER_API_URL?.trim() || null,
    timeoutMs: parseTimeout(source.FISCAL_PROVIDER_TIMEOUT_MS),
  };
}

export function toSafeFiscalProviderConfig(config: FiscalProviderConfig) {
  return {
    provider: config.provider,
    environment: config.environment,
    enabled: config.enabled,
    sandbox: config.sandbox,
    apiUrl: config.apiUrl,
    timeoutMs: config.timeoutMs,
  };
}
