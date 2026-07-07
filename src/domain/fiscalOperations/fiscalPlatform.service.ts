import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { CommercialOperation } from '../payments/commercialOperation.model';
import { PaymentSettlement } from '../payments/paymentSettlement.model';
import { FiscalOperation, FiscalOperationStatus, IFiscalOperation } from './fiscalOperation.model';
import { FiscalOperationHistory } from './fiscalOperationHistory.model';
import { resolveFiscalPlatformProvider } from './fiscalPlatformProvider';

export const fiscalPlatformAuditActions = {
  fiscalOperationCreated: 'FISCAL_OPERATION_CREATED',
  fiscalOperationDuplicateIgnored: 'FISCAL_OPERATION_DUPLICATE_IGNORED',
  invoiceStamped: 'INVOICE_STAMPED',
  invoiceDelivered: 'INVOICE_DELIVERED',
  invoiceStampFailed: 'INVOICE_STAMP_FAILED',
  invoiceCancelRequested: 'INVOICE_CANCEL_REQUESTED',
  invoiceCancelled: 'INVOICE_CANCELLED',
  fiscalRecoveryExecuted: 'FISCAL_RECOVERY_EXECUTED',
} as const;

function assertObjectId(id: string, error = 'invalid_object_id') {
  if (!Types.ObjectId.isValid(id)) throw Object.assign(new Error(error), { status: 400 });
  return new Types.ObjectId(id);
}

function sanitizeMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const blocked = ['secret', 'token', 'password', 'authorization', 'payload'];
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !blocked.some((blockedKey) => key.toLowerCase().includes(blockedKey)))
      .slice(0, 25)
  );
}

async function audit(actor: string, action: string, metadata: Record<string, unknown> = {}) {
  await Audit.create({ actor, action, metadata } as any);
}

async function history(
  operation: IFiscalOperation & { _id: Types.ObjectId },
  event: string,
  fromStatus: FiscalOperationStatus | undefined,
  toStatus: FiscalOperationStatus,
  actor: string,
  metadata: Record<string, unknown> = {},
) {
  await FiscalOperationHistory.create({
    fiscalOperationId: operation._id,
    commercialOperationId: operation.commercialOperationId,
    event,
    fromStatus,
    toStatus,
    actor,
    provider: operation.provider,
    uuid: operation.uuid,
    xmlLocation: operation.xmlLocation,
    pdfLocation: operation.pdfLocation,
    metadata,
  });
}

async function transition(
  operation: IFiscalOperation & { _id: Types.ObjectId; save: () => Promise<any> },
  toStatus: FiscalOperationStatus,
  event: string,
  actor: string,
  metadata: Record<string, unknown> = {},
) {
  const fromStatus = operation.invoiceStatus;
  operation.invoiceStatus = toStatus;
  await operation.save();
  await history(operation, event, fromStatus, toStatus, actor, metadata);
}

export async function emitFiscalOperationInvoice(
  operation: IFiscalOperation & { _id: Types.ObjectId; save: () => Promise<any> },
  actor = 'system',
  options: { recovery?: boolean } = {},
) {
  const lock = await FiscalOperation.findOneAndUpdate(
    { _id: operation._id, invoiceStatus: { $in: ['created', 'failed'] } },
    { $set: { invoiceStatus: 'pending_stamp', lastError: undefined, transientError: false } },
    { new: false }
  );
  if (!lock) {
    const current = await FiscalOperation.findById(operation._id);
    if (!current) throw Object.assign(new Error('fiscal_operation_not_found'), { status: 404 });
    return current;
  }

  const locked = await FiscalOperation.findById(operation._id);
  if (!locked) throw Object.assign(new Error('fiscal_operation_not_found'), { status: 404 });
  await history(locked as any, 'STAMP_REQUESTED', lock.invoiceStatus, 'pending_stamp', actor);

  const provider = resolveFiscalPlatformProvider(locked.provider);

  const result = await provider.emitInvoice(locked, options);
  if (!result.ok) {
    locked.invoiceStatus = 'failed';
    locked.providerMessage = result.message;
    locked.lastError = result.message;
    locked.transientError = Boolean(result.temporary);
    await locked.save();
    await history(locked as any, 'STAMP_FAILED', 'pending_stamp', 'failed', actor, {
      temporary: Boolean(result.temporary),
      definitive: Boolean(result.definitive),
    });
    await audit(actor, fiscalPlatformAuditActions.invoiceStampFailed, {
      fiscalOperationId: String(locked._id),
      commercialOperationId: String(locked.commercialOperationId),
      temporary: Boolean(result.temporary),
      definitive: Boolean(result.definitive),
    });
    return locked;
  }

  locked.providerReference = result.providerReference;
  locked.uuid = result.uuid;
  locked.xmlLocation = result.xmlLocation || await provider.downloadXML(locked);
  locked.pdfLocation = result.pdfLocation || await provider.downloadPDF(locked);
  locked.providerMessage = result.message;
  locked.lastError = undefined;
  locked.transientError = false;
  await locked.save();
  await transition(locked as any, 'stamped', 'INVOICE_STAMPED', actor, { uuid: locked.uuid });
  await audit(actor, fiscalPlatformAuditActions.invoiceStamped, {
    fiscalOperationId: String(locked._id),
    commercialOperationId: String(locked.commercialOperationId),
    uuid: locked.uuid,
  });
  await transition(locked as any, 'delivery_pending', 'DELIVERY_PENDING', actor);
  await transition(locked as any, 'delivered', 'INVOICE_DELIVERED', actor, {
    xmlLocation: locked.xmlLocation,
    pdfLocation: locked.pdfLocation,
  });
  await audit(actor, fiscalPlatformAuditActions.invoiceDelivered, {
    fiscalOperationId: String(locked._id),
    commercialOperationId: String(locked.commercialOperationId),
  });

  return locked;
}

export async function createFiscalOperation(input: {
  commercialOperationId: string;
  provider?: string;
  metadata?: unknown;
  actorId?: string;
}) {
  const commercialOperationId = assertObjectId(input.commercialOperationId, 'invalid_commercial_operation_id');
  const settlement = await PaymentSettlement.findOne({ operationId: commercialOperationId });
  if (!settlement) throw Object.assign(new Error('payment_settled_required'), { status: 409 });
  const commercialOperation = await CommercialOperation.findById(commercialOperationId).lean();
  if (!commercialOperation) throw Object.assign(new Error('commercial_operation_not_found'), { status: 404 });

  const existing = await FiscalOperation.findOne({ commercialOperationId });
  if (existing) {
    await audit(input.actorId || 'system', fiscalPlatformAuditActions.fiscalOperationDuplicateIgnored, {
      fiscalOperationId: String(existing._id),
      commercialOperationId: String(commercialOperationId),
    });
    return { status: 200, body: existing };
  }

  let operation: IFiscalOperation & { _id: Types.ObjectId; save: () => Promise<any> };
  try {
    operation = await FiscalOperation.create({
      operationId: settlement._id,
      commercialOperationId,
      invoiceStatus: 'created',
      provider: input.provider || 'mock',
      amount: settlement.amount,
      currency: settlement.currency,
      metadata: sanitizeMetadata(input.metadata),
    }) as any;
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const duplicate = await FiscalOperation.findOne({ commercialOperationId });
    if (!duplicate) throw error;
    await audit(input.actorId || 'system', fiscalPlatformAuditActions.fiscalOperationDuplicateIgnored, {
      fiscalOperationId: String(duplicate._id),
      commercialOperationId: String(commercialOperationId),
    });
    return { status: 200, body: duplicate };
  }
  await history(operation as any, 'FISCAL_OPERATION_CREATED', undefined, 'created', input.actorId || 'system');
  await audit(input.actorId || 'system', fiscalPlatformAuditActions.fiscalOperationCreated, {
    fiscalOperationId: String(operation._id),
    commercialOperationId: String(commercialOperationId),
  });

  const emitted = await emitFiscalOperationInvoice(operation as any, input.actorId || 'system');
  return { status: 201, body: emitted };
}

export async function getFiscalOperation(id: string) {
  return FiscalOperation.findById(assertObjectId(id)).lean();
}

export async function getFiscalHistory(operationId: string) {
  const id = assertObjectId(operationId);
  const operation = await FiscalOperation.findOne({ $or: [{ _id: id }, { commercialOperationId: id }] }).lean();
  if (!operation) return null;
  const items = await FiscalOperationHistory.find({ fiscalOperationId: operation._id })
    .sort({ createdAt: 1 })
    .lean();
  return { operation, items };
}

export async function cancelFiscalInvoice(input: {
  fiscalOperationId: string;
  actorId: string;
  reason?: string;
}) {
  const operation = await FiscalOperation.findById(assertObjectId(input.fiscalOperationId));
  if (!operation) throw Object.assign(new Error('fiscal_operation_not_found'), { status: 404 });
  if (!['stamped', 'delivery_pending', 'delivered'].includes(operation.invoiceStatus)) {
    throw Object.assign(new Error('invoice_not_cancellable'), { status: 409 });
  }

  operation.cancellationRequestedBy = assertObjectId(input.actorId, 'invalid_actor_id');
  operation.cancellationRequestedAt = new Date();
  operation.cancellationReason = input.reason || '02';
  await operation.save();
  await transition(operation as any, 'cancellation_requested', 'INVOICE_CANCEL_REQUESTED', input.actorId, {
    reason: operation.cancellationReason,
  });
  await audit(input.actorId, fiscalPlatformAuditActions.invoiceCancelRequested, {
    fiscalOperationId: String(operation._id),
  });

  const provider = resolveFiscalPlatformProvider(operation.provider);
  const result = await provider.cancelInvoice(operation);
  if (!result.ok) {
    operation.invoiceStatus = 'failed';
    operation.lastError = result.message;
    operation.providerMessage = result.message;
    operation.transientError = Boolean(result.temporary);
    await operation.save();
    await history(operation as any, 'CANCELLATION_FAILED', 'cancellation_requested', 'failed', input.actorId, {
      temporary: Boolean(result.temporary),
      definitive: Boolean(result.definitive),
    });
    return { status: 409, body: { ok: false, error: result.message, operation } };
  }

  operation.providerReference = result.providerReference || operation.providerReference;
  operation.cancelledAt = new Date();
  operation.providerMessage = result.message;
  await operation.save();
  await transition(operation as any, 'cancelled', 'INVOICE_CANCELLED', input.actorId);
  await audit(input.actorId, fiscalPlatformAuditActions.invoiceCancelled, {
    fiscalOperationId: String(operation._id),
    commercialOperationId: String(operation.commercialOperationId),
  });
  return { status: 200, body: { ok: true, operation } };
}

export async function listAdminFiscalOperations(query: any = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};
  if (query.status) filter.invoiceStatus = String(query.status);
  const [items, total] = await Promise.all([
    FiscalOperation.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    FiscalOperation.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function executeFiscalRecovery(actor = 'system') {
  const candidates = await FiscalOperation.find({ invoiceStatus: 'failed', transientError: true }).sort({ updatedAt: 1 }).limit(25);
  let recovered = 0;
  for (const operation of candidates) {
    const emitted = await emitFiscalOperationInvoice(operation as any, actor, { recovery: true });
    if (emitted.invoiceStatus === 'delivered') recovered += 1;
  }
  await audit(actor, fiscalPlatformAuditActions.fiscalRecoveryExecuted, { candidates: candidates.length, recovered });
  return { candidates: candidates.length, recovered };
}
