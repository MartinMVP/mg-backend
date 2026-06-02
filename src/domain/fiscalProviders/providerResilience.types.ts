export type ProviderResilienceConfig = {
  timeoutMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  circuitBreakerEnabled: boolean;
  failureThreshold: number;
  resetTimeoutMs: number;
  maxProviderPayloadBytes: number;
};

export const defaultProviderResilienceConfig: ProviderResilienceConfig = {
  timeoutMs: 10_000,
  maxRetries: 2,
  retryBackoffMs: 1_000,
  circuitBreakerEnabled: false,
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  maxProviderPayloadBytes: 256_000,
};

export function validateProviderResilienceConfig(config: ProviderResilienceConfig) {
  const issues: string[] = [];

  if (!Number.isFinite(config.timeoutMs) || config.timeoutMs < 100 || config.timeoutMs > 60_000) {
    issues.push('sandbox_timeout_invalid');
  }

  if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0 || config.maxRetries > 5) {
    issues.push('sandbox_max_retries_invalid');
  }

  if (!Number.isFinite(config.retryBackoffMs) || config.retryBackoffMs < 0 || config.retryBackoffMs > 60_000) {
    issues.push('sandbox_retry_backoff_invalid');
  }

  if (!Number.isInteger(config.failureThreshold) || config.failureThreshold < 1 || config.failureThreshold > 100) {
    issues.push('sandbox_failure_threshold_invalid');
  }

  if (!Number.isFinite(config.resetTimeoutMs) || config.resetTimeoutMs < 1_000 || config.resetTimeoutMs > 600_000) {
    issues.push('sandbox_reset_timeout_invalid');
  }

  if (
    !Number.isInteger(config.maxProviderPayloadBytes)
    || config.maxProviderPayloadBytes < 1_024
    || config.maxProviderPayloadBytes > 1_048_576
  ) {
    issues.push('sandbox_payload_limit_invalid');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}
