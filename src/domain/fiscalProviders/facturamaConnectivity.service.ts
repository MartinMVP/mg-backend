import { getFiscalProviderConfig } from './fiscalProvider.config';
import { resolveFacturamaSecretValues, resolveProviderSecretStatus } from './providerSecret.resolver';
import { FacturamaHttpClient } from './facturamaHttpClient';
import { ProviderHttpClient } from './providerHttpClient.interface';
import { normalizeProviderError, runProviderOperation } from './providerRuntime.service';
import { traceProviderOperation } from './providerTrace.service';
import { findFiscalProviderDescriptor } from './fiscalProvider.registry';
import {
  getFacturamaConnectivitySnapshot,
  setFacturamaConnectivitySnapshot,
} from './facturamaConnectivity.state';

export type FacturamaConnectivityResult = {
  ok: boolean;
  provider: 'facturama';
  environment: string;
  externalConnectivity: 'healthy' | 'failed';
  message: string;
  checkedAt: Date;
  httpStatus?: number;
  readiness?: FacturamaConnectivityReadiness;
};

export type FacturamaConnectivityOptions = {
  httpClient?: ProviderHttpClient;
  path?: string;
};

export type FacturamaConnectivityReadiness = {
  ready: boolean;
  issues: string[];
  provider: 'facturama';
  environment: string;
  hasApiUrl: boolean;
  hasCredentials: boolean;
};

let httpClientFactory: ((config: ReturnType<typeof getFacturamaConfig>) => ProviderHttpClient) | null = null;

function getFacturamaConfig() {
  return getFiscalProviderConfig({
    ...process.env,
    FISCAL_PROVIDER: 'facturama',
    FACTURAMA_ENVIRONMENT: process.env.FACTURAMA_ENVIRONMENT || 'sandbox',
  });
}

export function evaluateFacturamaConnectivityReadiness(config = getFacturamaConfig()): FacturamaConnectivityReadiness {
  const issues: string[] = [];
  const secrets = resolveProviderSecretStatus(process.env, config);
  const descriptor = findFiscalProviderDescriptor('facturama');

  if (!descriptor) issues.push('facturama_provider_not_registered');
  if (!config.enabled) issues.push('facturama_disabled');
  if (config.environment !== 'sandbox') issues.push('facturama_environment_invalid');
  if (!config.sandbox) issues.push('sandbox_flag_required');
  if (!config.apiUrl) issues.push('facturama_api_url_missing');
  if (!secrets.hasCredentials) issues.push('facturama_credentials_missing');
  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 60_000) {
    issues.push('facturama_timeout_invalid');
  }

  return {
    ready: issues.length === 0,
    issues: [...new Set(issues)],
    provider: 'facturama',
    environment: config.environment,
    hasApiUrl: Boolean(config.apiUrl),
    hasCredentials: secrets.hasCredentials,
  };
}

export function getFacturamaProviderConfigForDiagnostics() {
  return getFacturamaConfig();
}

export function getFacturamaConnectivityHealth() {
  return getFacturamaConnectivitySnapshot();
}

export function setFacturamaHttpClientFactoryForTests(
  factory: ((config: ReturnType<typeof getFacturamaConfig>) => ProviderHttpClient) | null
) {
  httpClientFactory = factory;
}

export async function testFacturamaConnectivity(options: FacturamaConnectivityOptions = {}) {
  const config = getFacturamaConfig();
  const readiness = evaluateFacturamaConnectivityReadiness(config);
  const checkedAt = new Date();

  if (!readiness.ready) {
    const message = readiness.issues.join(',');
    setFacturamaConnectivitySnapshot({
      status: 'failed',
      message,
      checkedAt,
    });

    return {
      ok: false,
      provider: 'facturama',
      environment: config.environment,
      externalConnectivity: 'failed',
      message,
      checkedAt,
      readiness,
    } satisfies FacturamaConnectivityResult;
  }

  const credentials = resolveFacturamaSecretValues(process.env);
  const httpClient = options.httpClient
    || httpClientFactory?.(config)
    || new FacturamaHttpClient({
      apiUrl: config.apiUrl || '',
      username: credentials.username,
      password: credentials.password,
      apiKey: credentials.apiKey,
    });
  const path = options.path || process.env.FACTURAMA_CONNECTIVITY_PATH || '/';

  try {
    const response = await traceProviderOperation(
      {
        providerName: 'facturama',
        providerEnvironment: config.environment,
        operation: 'status',
        requestPayload: {
          provider: 'facturama',
          diagnostic: 'connectivity',
          path,
          hasApiUrl: Boolean(config.apiUrl),
          hasCredentials: true,
        },
        maxPayloadBytes: config.maxPayloadBytes,
      },
      () => runProviderOperation({
        providerName: 'facturama',
        operationName: 'testConnectivity',
        options: config,
        operation: () => httpClient.get(path, { timeoutMs: config.timeoutMs }),
      })
    );

    const result = {
      ok: response.ok,
      provider: 'facturama',
      environment: config.environment,
      externalConnectivity: response.ok ? 'healthy' : 'failed',
      message: response.message,
      checkedAt: new Date(),
      httpStatus: response.status,
    } satisfies FacturamaConnectivityResult;

    setFacturamaConnectivitySnapshot({
      status: result.externalConnectivity,
      message: result.message,
      checkedAt: result.checkedAt,
      httpStatus: result.httpStatus,
    });

    return result;
  } catch (error) {
    const message = normalizeProviderError(error);
    const result = {
      ok: false,
      provider: 'facturama',
      environment: config.environment,
      externalConnectivity: 'failed',
      message,
      checkedAt: new Date(),
    } satisfies FacturamaConnectivityResult;

    setFacturamaConnectivitySnapshot({
      status: 'failed',
      message,
      checkedAt: result.checkedAt,
    });

    return result;
  }
}
