export type FiscalProviderConfig = {
  provider: string;
  environment: string;
  enabled: boolean;
  sandbox: boolean;
  apiUrl: string | null;
  timeoutMs: number;
  maxProviderPayloadBytes: number;
};

function parseBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseTimeout(value: string | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10_000;
}

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getFiscalProviderConfig(source: NodeJS.ProcessEnv = process.env): FiscalProviderConfig {
  const provider = source.FISCAL_PROVIDER?.trim() || 'mock';
  const environment = source.FISCAL_PROVIDER_ENVIRONMENT?.trim() || (provider === 'mock' ? 'mock' : 'sandbox');
  const defaultEnabled = parseBool(source.FISCAL_PROVIDER_ENABLED, true);
  const sandboxEnabled = parseBool(source.FISCAL_PROVIDER_SANDBOX_ENABLED, false);
  const isSandboxPac = provider === 'sandbox-pac';

  return {
    provider,
    environment,
    enabled: isSandboxPac ? defaultEnabled && sandboxEnabled : defaultEnabled,
    sandbox: parseBool(source.FISCAL_PROVIDER_SANDBOX, environment !== 'production'),
    apiUrl: (
      isSandboxPac
        ? source.FISCAL_PROVIDER_SANDBOX_API_URL?.trim() || source.FISCAL_PROVIDER_API_URL?.trim()
        : source.FISCAL_PROVIDER_API_URL?.trim()
    ) || null,
    timeoutMs: parseTimeout(
      isSandboxPac
        ? source.FISCAL_PROVIDER_SANDBOX_TIMEOUT_MS || source.FISCAL_PROVIDER_TIMEOUT_MS
        : source.FISCAL_PROVIDER_TIMEOUT_MS
    ),
    maxProviderPayloadBytes: parsePositiveInt(source.FISCAL_PROVIDER_MAX_PAYLOAD_BYTES, 256_000),
  };
}

export function toSafeFiscalProviderConfig(config: FiscalProviderConfig) {
  return {
    provider: config.provider,
    environment: config.environment,
    enabled: config.enabled,
    sandbox: config.sandbox,
    hasApiUrl: Boolean(config.apiUrl),
    timeoutMs: config.timeoutMs,
    maxProviderPayloadBytes: config.maxProviderPayloadBytes,
  };
}
