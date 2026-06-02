import { Types } from 'mongoose';
import { ProviderTrace, ProviderTraceOperation } from './providerTrace.model';

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
};

type CompleteProviderTraceInput = {
  responsePayload?: unknown;
  errorMessage?: string;
};

const forbiddenKeyPattern = /credential|password|secret|token|api[_-]?key|authorization|xml|pdf|uuid|sello|certificado|cadena|timbre/i;

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

export async function startProviderTrace(input: StartProviderTraceInput) {
  return ProviderTrace.create({
    invoiceRecordId: input.invoiceRecordId,
    invoiceQueueId: input.invoiceQueueId,
    transactionId: input.transactionId,
    providerName: input.providerName,
    providerEnvironment: input.providerEnvironment,
    operation: input.operation,
    status: 'pending',
    requestPayload: sanitizeProviderPayload(input.requestPayload),
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

  trace.status = 'success';
  trace.responsePayload = sanitizeProviderPayload(input.responsePayload);
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

  trace.status = 'failed';
  trace.responsePayload = sanitizeProviderPayload(input.responsePayload);
  trace.errorMessage = input.errorMessage || 'Provider operation failed';
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
      });
      return result;
    }

    await completeProviderTraceSuccess(trace._id, { responsePayload: result });
    return result;
  } catch (error: any) {
    await completeProviderTraceFailed(trace._id, {
      errorMessage: error?.message || 'Provider operation failed',
    });
    throw error;
  }
}
