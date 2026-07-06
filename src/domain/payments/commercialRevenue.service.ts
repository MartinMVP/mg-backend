import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Notification } from '../notifications/notification.model';
import {
  CommercialOperation,
  commercialOperationTypes,
  CommercialOperationType,
} from './commercialOperation.model';
import { PaymentTransaction } from './paymentTransaction.model';
import { PaymentSettlement } from './paymentSettlement.model';
import { PaymentWebhookLog } from './paymentWebhookLog.model';
import { RefundRecord } from './refundRecord.model';
import { ReconciliationRecord } from './reconciliationRecord.model';

export const commercialRevenueAuditActions = {
  commercialOperationCreated: 'COMMERCIAL_OPERATION_CREATED',
  paymentIntentCreated: 'PAYMENT_INTENT_CREATED',
  paymentSettled: 'PAYMENT_SETTLED',
  paymentFailed: 'PAYMENT_FAILED',
  paymentRefunded: 'PAYMENT_REFUNDED',
  reconciliationCompleted: 'RECONCILIATION_COMPLETED',
} as const;

const paymentWebhookSecretFallback = 'test-payment-webhook-secret';

function paymentWebhookSecret() {
  return process.env.PAYMENTS_WEBHOOK_SECRET || paymentWebhookSecretFallback;
}

function assertObjectId(id: string, error = 'invalid_object_id') {
  if (!Types.ObjectId.isValid(id)) throw Object.assign(new Error(error), { status: 400 });
  return new Types.ObjectId(id);
}

function parseAmount(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw Object.assign(new Error('amount_must_be_positive'), { status: 400 });
  }
  return Math.round(amount * 100) / 100;
}

function normalizeCurrency(value: unknown) {
  const currency = String(value || 'MXN').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error('invalid_currency'), { status: 400 });
  return currency;
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

async function notify(userId: Types.ObjectId | undefined, type: any, title: string, message: string) {
  if (!userId) return;
  await Notification.create({ userId, type, title, message, read: false });
}

async function nextOperationNumber() {
  const year = new Date().getFullYear();
  const prefix = `EG-${year}-`;
  const latest = await CommercialOperation.findOne({ operationNumber: { $regex: `^${prefix}` } })
    .sort({ operationNumber: -1 })
    .select('operationNumber')
    .lean();
  const last = latest?.operationNumber ? Number(latest.operationNumber.slice(prefix.length)) : 0;
  return `${prefix}${String(last + 1).padStart(9, '0')}`;
}

export function createPaymentWebhookSignature(rawBody: Buffer | string, secret = paymentWebhookSecret()) {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function verifyPaymentWebhookSignature(rawBody: Buffer, signature: string | undefined) {
  if (!signature) throw Object.assign(new Error('payment_signature_missing'), { status: 400 });
  const expected = createPaymentWebhookSignature(rawBody);
  const received = Buffer.from(signature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) {
    throw Object.assign(new Error('payment_signature_invalid'), { status: 400 });
  }
}

function payloadHash(rawBody: Buffer) {
  return createHash('sha256').update(rawBody).digest('hex');
}

export async function createCommercialOperation(input: {
  operationType: string;
  referenceType: string;
  referenceId: string;
  amount: unknown;
  currency?: unknown;
  metadata?: unknown;
  actorId?: string;
}) {
  const operationType = String(input.operationType || '').trim() as CommercialOperationType;
  if (!commercialOperationTypes.includes(operationType)) {
    throw Object.assign(new Error('invalid_operation_type'), { status: 400 });
  }
  if (operationType !== 'membership') {
    throw Object.assign(new Error('operation_type_not_enabled'), { status: 409 });
  }
  const referenceType = String(input.referenceType || '').trim();
  const referenceId = String(input.referenceId || '').trim();
  if (!referenceType || !referenceId) throw Object.assign(new Error('reference_required'), { status: 400 });

  const operation = await CommercialOperation.create({
    operationNumber: await nextOperationNumber(),
    operationType,
    referenceType,
    referenceId,
    amount: parseAmount(input.amount),
    currency: normalizeCurrency(input.currency),
    status: 'created',
    metadata: sanitizeMetadata(input.metadata),
    createdBy: input.actorId && Types.ObjectId.isValid(input.actorId) ? new Types.ObjectId(input.actorId) : undefined,
  });

  await audit(input.actorId || 'system', commercialRevenueAuditActions.commercialOperationCreated, {
    operationId: String(operation._id),
    operationNumber: operation.operationNumber,
    operationType,
  });

  return operation;
}

export async function getCommercialOperation(id: string) {
  return CommercialOperation.findById(assertObjectId(id)).lean();
}

export async function createPaymentIntent(input: { operationId: string; actorId?: string }) {
  const operation = await CommercialOperation.findById(assertObjectId(input.operationId));
  if (!operation) throw Object.assign(new Error('operation_not_found'), { status: 404 });
  if (['settled', 'refunded', 'cancelled'].includes(operation.status)) {
    throw Object.assign(new Error('operation_not_payable'), { status: 409 });
  }

  const existing = await PaymentTransaction.findOne({
    operationId: operation._id,
    status: { $in: ['intent_created', 'checkout_created', 'payment_pending', 'settled'] },
  }).sort({ createdAt: -1 });
  if (existing?.checkoutUrl) return existing;

  const providerPaymentIntentId = `pi_${randomUUID()}`;
  const providerCheckoutId = `chk_${randomUUID()}`;
  const transaction = await PaymentTransaction.create({
    operationId: operation._id,
    operationNumber: operation.operationNumber,
    provider: 'internal',
    providerPaymentIntentId,
    providerCheckoutId,
    amount: operation.amount,
    currency: operation.currency,
    status: 'checkout_created',
    checkoutUrl: `https://payments.enlaceganadero.test/checkout/${providerCheckoutId}`,
    metadata: { operationType: operation.operationType },
  });

  operation.status = 'checkout_pending';
  await operation.save();

  await audit(input.actorId || 'system', commercialRevenueAuditActions.paymentIntentCreated, {
    operationId: String(operation._id),
    paymentTransactionId: String(transaction._id),
  });

  return transaction;
}

export async function handlePaymentWebhook(rawBody: Buffer, signature: string | undefined) {
  verifyPaymentWebhookSignature(rawBody, signature);
  const event = JSON.parse(rawBody.toString('utf8'));
  if (!event?.id || !event?.type || !event?.data?.object) {
    throw Object.assign(new Error('payment_event_invalid'), { status: 400 });
  }

  const hash = payloadHash(rawBody);
  const existingLog = await PaymentWebhookLog.findOne({ providerEventId: event.id });
  if (existingLog?.processed) {
    return { ok: true, duplicate: true, eventId: event.id, processed: false };
  }

  const log = existingLog ?? await PaymentWebhookLog.create({
    provider: 'stripe',
    providerEventId: event.id,
    eventType: event.type,
    payloadHash: hash,
    processed: false,
    attempts: 0,
  });
  log.attempts += 1;

  try {
    const object = event.data.object;
    const operationId = String(object.operationId || object.metadata?.operationId || '');
    const operation = await CommercialOperation.findById(assertObjectId(operationId, 'invalid_operation_id'));
    if (!operation) throw Object.assign(new Error('operation_not_found'), { status: 404 });

    const transaction = await PaymentTransaction.findOne({
      operationId: operation._id,
      providerPaymentIntentId: String(object.paymentIntentId || object.payment_intent || ''),
    }).sort({ createdAt: -1 });
    if (!transaction) throw Object.assign(new Error('payment_transaction_not_found'), { status: 404 });

    if (event.type === 'payment.failed') {
      transaction.status = 'failed';
      transaction.providerEventId = event.id;
      operation.status = 'failed';
      await Promise.all([transaction.save(), operation.save()]);
      await audit('provider', commercialRevenueAuditActions.paymentFailed, { operationId: String(operation._id), eventId: event.id });
      await notify(operation.createdBy, 'payment_failed', 'Pago fallido', `No se pudo procesar ${operation.operationNumber}.`);
      log.processed = true;
      log.processedAt = new Date();
      await log.save();
      return { ok: true, eventId: event.id, processed: true };
    }

    if (event.type !== 'payment.settled') throw Object.assign(new Error('payment_event_not_supported'), { status: 400 });

    const existingSettlement = await PaymentSettlement.findOne({ operationId: operation._id });
    if (!existingSettlement) {
      transaction.status = 'settled';
      transaction.providerEventId = event.id;
      operation.status = 'settled';
      await Promise.all([transaction.save(), operation.save()]);
      await PaymentSettlement.create({
        operationId: operation._id,
        operationNumber: operation.operationNumber,
        operationType: operation.operationType,
        referenceType: operation.referenceType,
        referenceId: operation.referenceId,
        amount: operation.amount,
        currency: operation.currency,
        paymentTransactionId: transaction._id,
        providerEventId: event.id,
        settledAt: object.settledAt ? new Date(object.settledAt) : new Date(),
      });
      await audit('provider', commercialRevenueAuditActions.paymentSettled, { operationId: String(operation._id), eventId: event.id });
      await notify(operation.createdBy, 'payment_settled', 'Pago liquidado', `Pago liquidado para ${operation.operationNumber}.`);
    }

    log.processed = true;
    log.processedAt = new Date();
    await log.save();
    return { ok: true, eventId: event.id, processed: true, duplicate: Boolean(existingSettlement) };
  } catch (error) {
    log.lastError = error instanceof Error ? error.message : String(error);
    await log.save();
    throw error;
  }
}

export async function listPaymentTransactions(query: any = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = String(query.status);
  if (query.operationId && Types.ObjectId.isValid(String(query.operationId))) filter.operationId = String(query.operationId);
  const [items, total] = await Promise.all([
    PaymentTransaction.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    PaymentTransaction.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function requestRefund(input: { operationId: string; amount?: unknown; reason?: string; actorId: string }) {
  const operation = await CommercialOperation.findById(assertObjectId(input.operationId));
  if (!operation) throw Object.assign(new Error('operation_not_found'), { status: 404 });
  const transaction = await PaymentTransaction.findOne({ operationId: operation._id, status: 'settled' }).sort({ createdAt: -1 });
  if (!transaction || operation.status !== 'settled') {
    const rejected = await RefundRecord.create({
      operationId: operation._id,
      amount: input.amount ? parseAmount(input.amount) : operation.amount,
      currency: operation.currency,
      status: 'rejected',
      reason: input.reason || 'operation_not_settled',
      requestedBy: assertObjectId(input.actorId, 'invalid_actor_id'),
    });
    return { status: 409, body: { ok: false, error: 'operation_not_refundable', refund: rejected } };
  }

  const refund = await RefundRecord.create({
    operationId: operation._id,
    paymentTransactionId: transaction._id,
    amount: input.amount ? parseAmount(input.amount) : operation.amount,
    currency: operation.currency,
    status: 'processed',
    reason: input.reason,
    providerRefundId: `rf_${randomUUID()}`,
    requestedBy: assertObjectId(input.actorId, 'invalid_actor_id'),
    processedAt: new Date(),
  });
  transaction.status = 'refunded';
  operation.status = 'refunded';
  await Promise.all([transaction.save(), operation.save()]);
  await audit(input.actorId, commercialRevenueAuditActions.paymentRefunded, { operationId: String(operation._id), refundId: String(refund._id) });
  await notify(operation.createdBy, 'refund_processed', 'Reembolso procesado', `Reembolso procesado para ${operation.operationNumber}.`);
  return { status: 201, body: { ok: true, refund } };
}

export async function reconcilePayments(actorId: string, provider = 'internal') {
  const [pendingPayments, duplicateGroups, providerErrors] = await Promise.all([
    PaymentTransaction.countDocuments({ status: { $in: ['intent_created', 'checkout_created', 'payment_pending'] } }),
    PaymentTransaction.aggregate<{ _id: string; count: number }>([
      { $group: { _id: '$providerPaymentIntentId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
    ]),
    PaymentWebhookLog.countDocuments({ processed: false, lastError: { $exists: true, $ne: '' } }),
  ]);
  const settledTransactions = await PaymentTransaction.distinct('_id', { status: 'settled' });
  const settlementTransactionIds = await PaymentSettlement.distinct('paymentTransactionId');
  const settledSet = new Set(settlementTransactionIds.map(String));
  const missingPayments = settledTransactions.filter((id) => !settledSet.has(String(id))).length;
  const duplicatePayments = duplicateGroups.reduce((sum, item) => sum + item.count - 1, 0);
  const differences = missingPayments + duplicatePayments + pendingPayments + providerErrors;

  const record = await ReconciliationRecord.create({
    provider,
    status: 'completed',
    differences,
    missingPayments,
    duplicatePayments,
    pendingPayments,
    providerErrors,
    metadata: { compared: 'revenue_vs_provider_snapshot' },
    executedAt: new Date(),
  });
  await audit(actorId, commercialRevenueAuditActions.reconciliationCompleted, { reconciliationId: String(record._id) });
  return record;
}

export async function listReconciliations(query: any = {}) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const [items, total] = await Promise.all([
    ReconciliationRecord.find().sort({ executedAt: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ReconciliationRecord.countDocuments(),
  ]);
  return { items, page, limit, total };
}
