import { defaultProviderResilienceConfig, ProviderResilienceConfig } from './providerResilience.types';

export type ProviderRuntimeCircuitState = 'closed' | 'open' | 'half_open';

export type ProviderRuntimeOptions = ProviderResilienceConfig;

export class ProviderRuntimeError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, retryable: boolean) {
    super(message);
    this.name = 'ProviderRuntimeError';
    this.code = code;
    this.retryable = retryable;
  }
}

type CircuitState = {
  state: ProviderRuntimeCircuitState;
  failures: number;
  openedAt?: number;
};

type RunProviderOperationInput<T> = {
  providerName: string;
  operationName: string;
  options?: Partial<ProviderRuntimeOptions>;
  operation: () => Promise<T>;
};

const circuitBreakers = new Map<string, CircuitState>();
const forbiddenTextPattern =
  /(token|secret|password|api[_-]?key|authorization|xml|pdf|uuid|sello|certificado|cadena|timbre)(\s*[:=]\s*)[^\s,;]+/gi;
const forbiddenWordPattern = /(xml|pdf|uuid|sello|certificado|cadena|timbre)/gi;
const MAX_SAFE_ERROR_LENGTH = 300;

function circuitKey(providerName: string, operationName: string) {
  return `${providerName}:${operationName}`;
}

function getCircuitState(key: string): CircuitState {
  const existing = circuitBreakers.get(key);
  if (existing) return existing;

  const initial: CircuitState = { state: 'closed', failures: 0 };
  circuitBreakers.set(key, initial);
  return initial;
}

function mergeRuntimeOptions(options: Partial<ProviderRuntimeOptions> = {}): ProviderRuntimeOptions {
  const maxPayloadBytes =
    options.maxPayloadBytes
    ?? options.maxProviderPayloadBytes
    ?? defaultProviderResilienceConfig.maxPayloadBytes;

  return {
    ...defaultProviderResilienceConfig,
    ...options,
    maxPayloadBytes,
    maxProviderPayloadBytes: options.maxProviderPayloadBytes ?? maxPayloadBytes,
  };
}

function sleep(ms: number) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableProviderError(error: unknown) {
  if (error instanceof ProviderRuntimeError) return error.retryable;
  if (typeof error === 'object' && error !== null && 'retryable' in error) {
    return Boolean((error as { retryable?: unknown }).retryable);
  }

  return false;
}

export function normalizeProviderError(error: unknown, fallback = 'Provider operation failed') {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;
  const safeMessage = rawMessage
    .replace(forbiddenTextPattern, '$1$2[redacted]')
    .replace(forbiddenWordPattern, '[redacted]');

  return safeMessage.length > MAX_SAFE_ERROR_LENGTH
    ? `${safeMessage.slice(0, MAX_SAFE_ERROR_LENGTH)}...`
    : safeMessage;
}

export function getProviderRuntimeOptions(options: Partial<ProviderRuntimeOptions> = {}) {
  return mergeRuntimeOptions(options);
}

export function getProviderCircuitBreakerState(providerName: string, operationName: string) {
  const key = circuitKey(providerName, operationName);
  const state = getCircuitState(key);

  return {
    providerName,
    operationName,
    state: state.state,
    failures: state.failures,
    openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
  };
}

export function listProviderCircuitBreakerStates() {
  return Array.from(circuitBreakers.entries()).map(([key, state]) => {
    const [providerName, operationName] = key.split(':');
    return {
      providerName,
      operationName,
      state: state.state,
      failures: state.failures,
      openedAt: state.openedAt ? new Date(state.openedAt).toISOString() : null,
    };
  });
}

export function resetProviderRuntimeState() {
  circuitBreakers.clear();
}

export async function runWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new ProviderRuntimeError('provider_timeout', 'Provider operation timed out', true));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runWithRetry<T>(
  operation: () => Promise<T>,
  options: Partial<ProviderRuntimeOptions> = {}
) {
  const runtimeOptions = mergeRuntimeOptions(options);
  let lastError: unknown;

  for (let attempt = 0; attempt <= runtimeOptions.maxRetries; attempt += 1) {
    try {
      const result = await operation();
      return { result, attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (!isRetryableProviderError(error) || attempt >= runtimeOptions.maxRetries) {
        throw error;
      }
      await sleep(runtimeOptions.retryBackoffMs);
    }
  }

  throw lastError;
}

export async function runProviderOperation<T>(input: RunProviderOperationInput<T>) {
  const options = mergeRuntimeOptions(input.options);
  const key = circuitKey(input.providerName, input.operationName);
  const circuit = getCircuitState(key);
  const now = Date.now();

  if (options.circuitBreakerEnabled && circuit.state === 'open') {
    if (circuit.openedAt && now - circuit.openedAt >= options.resetTimeoutMs) {
      circuit.state = 'half_open';
    } else {
      throw new ProviderRuntimeError('provider_circuit_open', 'Provider circuit breaker is open', true);
    }
  }

  try {
    const execution = await runWithRetry(
      () => runWithTimeout(input.operation, options.timeoutMs),
      options
    );

    if (options.circuitBreakerEnabled && circuit.state === 'half_open') {
      circuit.state = 'closed';
      circuit.failures = 0;
      circuit.openedAt = undefined;
    } else if (options.circuitBreakerEnabled && circuit.state === 'closed') {
      circuit.failures = 0;
    }

    return execution.result;
  } catch (error) {
    if (options.circuitBreakerEnabled) {
      circuit.failures += 1;
      if (circuit.state === 'half_open' || circuit.failures >= options.failureThreshold) {
        circuit.state = 'open';
        circuit.openedAt = Date.now();
      }
    }

    const message = normalizeProviderError(error);
    if (error instanceof ProviderRuntimeError) {
      throw new ProviderRuntimeError(error.code, message, error.retryable);
    }

    throw new ProviderRuntimeError('provider_operation_failed', message, isRetryableProviderError(error));
  }
}
