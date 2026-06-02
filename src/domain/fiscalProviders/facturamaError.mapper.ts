import { ProviderRuntimeError } from './providerRuntime.service';

type FacturamaSafeError = {
  code: string;
  message: string;
  retryable: boolean;
};

function safeMessage(message: string) {
  return message
    .replace(/(authorization|token|password|api[_-]?key|secret)(\s*[:=]\s*)[^\s,;]+/gi, '[redacted]')
    .replace(/(xml|pdf|uuid|sello|certificado|cadena|timbre)/gi, '[redacted]');
}

export function mapFacturamaHttpStatus(status: number, message?: string): FacturamaSafeError {
  if (status === 401 || status === 403) {
    return {
      code: 'facturama_auth_error',
      message: 'Facturama authentication failed',
      retryable: false,
    };
  }

  if (status === 408 || status === 429 || status >= 500) {
    return {
      code: 'facturama_network_error',
      message: safeMessage(message || 'Facturama temporary error'),
      retryable: true,
    };
  }

  return {
    code: 'facturama_unexpected_response',
    message: safeMessage(message || 'Facturama unexpected response'),
    retryable: false,
  };
}

export function mapFacturamaError(error: unknown): ProviderRuntimeError {
  if (error instanceof ProviderRuntimeError) return error;

  const rawMessage = error instanceof Error ? error.message : String(error || 'Facturama request failed');
  const message = safeMessage(rawMessage);

  if (/timeout/i.test(rawMessage)) {
    return new ProviderRuntimeError('facturama_timeout', 'Facturama request timed out', true);
  }

  if (/auth|401|403/i.test(rawMessage)) {
    return new ProviderRuntimeError('facturama_auth_error', 'Facturama authentication failed', false);
  }

  if (/network|fetch|ECONN|ENOTFOUND|ETIMEDOUT/i.test(rawMessage)) {
    return new ProviderRuntimeError('facturama_network_error', message, true);
  }

  return new ProviderRuntimeError('facturama_unexpected_response', message, false);
}
