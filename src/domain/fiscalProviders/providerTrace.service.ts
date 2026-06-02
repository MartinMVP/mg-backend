import { Types } from 'mongoose';
import { ProviderTrace, ProviderTraceOperation } from './providerTrace.model';
import { getFiscalProviderConfig } from './fiscalProvider.config';

type ProviderTraceRefs = {
  invoiceRecordId?: Types.ObjectId;
  invoiceQueueId?: Types.ObjectId;
  transactionId?: Types.ObjectId;
};

type StartProviderTraceInput = ProviderTraceRefs & {
  providerName: string;
  providerEnvironment?: string;
  operation: ProviderTraceOperation;
  requestPayload?: unknown;
  attempt?: number;
  maxPayloadBytes?: number;
};

type CompleteProviderTraceInput = {
  responsePayload?: unknown;
  errorMessage?: string;
  maxPayloadBytes?: number;
};

const forbiddenKeyPattern = /credential|password|secret|token|api[_-]?key|authorization|xml|pdf|uuid|sello|certificado|cadena|timbre/i;
const forbiddenValuePattern =
  /(token|secret|password|api[_-]?key|authorization|bearer|xml|pdf|uuid|sello|certificado|cadena|timbre)(\s*[:=]?\s*)[^\s,;]+/gi;
const forbiddenWordPattern = /(bearer|xml|pdf|uuid|sello|certificado|cadena|timbre)/gi;
const MAX_SAFE_TEXT_LENGTH = 300;

function maxPayloadBytes(fallback?: number) {
  return fallback || getFiscalProviderConfig().maxPayloadBytes;
}

function truncateText(value: string) {
  return value.length > MAX_SAFE_TEXT_LENGTH
    ? `${value.slice(0, MAX_SAFE_TEXT_LENGTH)}...`
    : value;
}

export function sanitizeProviderText(value: unknown) {
  const raw = value instanceof Error
    ? value.message
    : typeof value === 'string'
      ? value
      : value === null || value === undefined
        ? ''
        : String(value);

  return truncateText(raw
    .replace(forbiddenValuePattern, '$1$2[redacted]')
    .replace(forbiddenWordPattern, '[redacted]'));
}

function payloadSize(payload: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(payload), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function sanitizeProviderPayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) return payload;

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProviderPayload(item));
  }

  if (payload instanceof Types.ObjectId) {
    return String(payload);
  }

  if (payload instanceof Date) {
    return payload.toISOString();
  }

  if (typeof payload === 'string') {
    return sanitizeProviderText(payload);
  }

  if (typeof payload === 'object') {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (forbiddenKeyPattern.test(key)) continue;
      safe[key] = sanitizeProviderPayload(value);
    }
    return safe;
  }

  return payload;
}

export function sanitizeProviderPayloadForStorage(payload: unknown, limit = maxPayloadBytes()) {
  const sanitized = sanitizeProviderPayload(payload);
  const size = payloadSize(sanitized);

  if (size <= limit) {
    return { payload: sanitized, truncated: false };
  }

  return {
    payload: {
      payloadTruncated: true,
      originalSizeBytes: Number.isFinite(size) ? size : null,
      maxPayloadBytes: limit,
      preview: truncateText(JSON.stringify(sanitized).slice(0, Math.min(limit, MAX_SAFE_TEXT_LENGTH))),
    },
    truncated: true,
  };
}

export async function startProviderTrace(input: StartProviderTraceInput) {
  const requestPayload = sanitizeProviderPayloadForStorage(input.requestPayload, maxPayloadBytes(input.maxPayloadBytes));

  return ProviderTrace.create({
    invoiceRecordId: input.invoiceRecordId,
    invoiceQueueId: input.invoiceQueueId,
    transactionId: input.transactionId,
    providerName: input.providerName,
    providerEnvironment: input.providerEnvironment,
    operation: input.operation,
    status: 'pending',
    requestPayload: requestPayload.payload,
    requestPayloadTruncated: requestPayload.truncated,
    attempt: input.attempt,
    startedAt: new Date(),
  });
}

export async function completeProviderTraceSuccess(
  traceId: Types.ObjectId,
  input: CompleteProviderTraceInput = {}
) {
  const completedAt = new Date();
  const trace = await ProviderTrace.findById(traceId);
  if (!trace) return null;
  const responsePayload = sanitizeProviderPayloadForStorage(input.responsePayload, maxPayloadBytes(input.maxPayloadBytes));

  trace.status = 'success';
  trace.responsePayload = responsePayload.payload;
  trace.responsePayloadTruncated = responsePayload.truncated;
  trace.completedAt = completedAt;
  trace.durationMs = Math.max(0, completedAt.getTime() - trace.startedAt.getTime());
  trace.errorMessage = undefined;
  return trace.save();
}

export async function completeProviderTraceFailed(
  traceId: Types.ObjectId,
  input: CompleteProviderTraceInput = {}
) {
  const completedAt = new Date();
  const trace = await ProviderTrace.findById(traceId);
  if (!trace) return null;
  const responsePayload = sanitizeProviderPayloadForStorage(input.responsePayload, maxPayloadBytes(input.maxPayloadBytes));

  trace.status = 'failed';
  trace.responsePayload = responsePayload.payload;
  trace.responsePayloadTruncated = responsePayload.truncated;
  trace.errorMessage = sanitizeProviderText(input.errorMessage || 'Provider operation failed');
  trace.completedAt = completedAt;
  trace.durationMs = Math.max(0, completedAt.getTime() - trace.startedAt.getTime());
  return trace.save();
}

export async function traceProviderOperation<T>(
  input: StartProviderTraceInput,
  operation: () => Promise<T>
) {
  const trace = await startProviderTrace(input);

  try {
    const result = await operation();
    const providerResult = result as { ok?: boolean; message?: string; providerMessage?: string };
    if (providerResult?.ok === false) {
      await completeProviderTraceFailed(trace._id, {
        responsePayload: result,
        errorMessage: providerResult.providerMessage || providerResult.message || 'Provider operation failed',
        maxPayloadBytes: input.maxPayloadBytes,
      });
      return result;
    }

    await completeProviderTraceSuccess(trace._id, {
      responsePayload: result,
      maxPayloadBytes: input.maxPayloadBytes,
    });
    return result;
  } catch (error: any) {
    await completeProviderTraceFailed(trace._id, {
      errorMessage: error?.message || 'Provider operation failed',
      maxPayloadBytes: input.maxPayloadBytes,
    });
    throw error;
  }
}
