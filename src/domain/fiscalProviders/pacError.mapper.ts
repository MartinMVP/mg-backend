import { PacError, PacErrorCode } from './pacAdapter.types';

const fallbackMessages: Record<PacErrorCode, string> = {
  PAC_TIMEOUT: 'PAC operation timed out',
  PAC_VALIDATION_ERROR: 'PAC validation failed',
  PAC_AUTH_ERROR: 'PAC authentication failed',
  PAC_UNKNOWN_ERROR: 'Unknown PAC error',
};

const retryableCodes = new Set<PacErrorCode>(['PAC_TIMEOUT', 'PAC_UNKNOWN_ERROR']);

export function mapPacError(code: PacErrorCode, message?: string): PacError {
  return {
    code,
    message: message || fallbackMessages[code],
    retryable: retryableCodes.has(code),
  };
}
