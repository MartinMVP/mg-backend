import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { FiscalProfile } from '../fiscalProfiles/fiscalProfile.model';
import { InvoiceHistory } from '../invoiceRecords/invoiceHistory.model';
import { InvoiceRecord } from '../invoiceRecords/invoiceRecord.model';
import { Notification } from '../notifications/notification.model';
import { MembershipPaymentTransaction } from '../payments/membershipPaymentTransaction.model';
import { PaymentSettled } from '../payments/paymentSettled.event';
import { FiscalProviderError, getMembershipFiscalProvider } from './fiscalProvider';

export const fiscalMembershipAuditActions = {
  profileCreated: 'FISCAL_PROFILE_CREATED',
  profileUpdated: 'FISCAL_PROFILE_UPDATED',
  invoiceRequested: 'INVOICE_REQUESTED',
  invoiceProcessingStarted: 'INVOICE_PROCESSING_STARTED',
  invoiceIssued: 'INVOICE_ISSUED',
  invoiceFailed: 'INVOICE_FAILED',
  invoiceCancelRequested: 'INVOICE_CANCEL_REQUESTED',
  invoiceCancelled: 'INVOICE_CANCELLED',
  invoiceCancelFailed: 'INVOICE_CANCEL_FAILED',
  providerTimeout: 'FISCAL_PROVIDER_TIMEOUT',
  providerError: 'FISCAL_PROVIDER_ERROR',
  publicGeneralInvoiceCreated: 'PUBLIC_GENERAL_INVOICE_CREATED',
} as const;

const publicGeneralReceiver = {
  rfc: 'XAXX010101000',
  razonSocial: 'PUBLICO EN GENERAL',
  regimenFiscal: '616',
  codigoPostal: '00000',
  usoCFDI: 'S01',
  publicGeneral: true,
};

function asObjectId(id: string | Types.ObjectId, label: string) {
  if (id instanceof Types.ObjectId) return id;
  if (!Types.ObjectId.isValid(id)) throw new Error(`invalid_${label}`);
  return new Types.ObjectId(id);
}

function safeProviderMetadata(metadata?: Record<string, unknown>) {
  const mode = metadata?.providerMode ?? metadata?.fiscalProviderMode;
  return mode ? { providerMode: mode } : {};
}

function isValidFiscalProfile(profile: any) {
  return Boolean(
    profile?.isValidated &&
    /^[A-Z0-9]{12,13}$/.test(String(profile.rfc || '')) &&
    /^\d{5}$/.test(String(profile.codigoPostal || ''))
  );
}

async function audit(actor: string, action: string, invoiceRecordId?: Types.ObjectId, transactionId?: Types.ObjectId) {
  await Audit.create({ actor, action, invoiceRecordId, transactionId });
}

async function history(invoice: any, event: string, metadata: Record<string, unknown> = {}) {
  await InvoiceHistory.create({
    invoiceId: invoice._id,
    transactionId: invoice.transactionId,
    membershipId: invoice.membershipId,
    userId: invoice.userId,
    event,
    metadata,
    timestamp: new Date(),
  });
}

async function notify(userId: Types.ObjectId, type: any, title: string, message: string) {
  await Notification.create({ userId, type, title, message, read: false });
}

async function resolveReceiver(userId: Types.ObjectId) {
  const profile = await FiscalProfile.findOne({ userId }).lean();
  if (isValidFiscalProfile(profile)) {
    return {
      receiver: {
        rfc: profile!.rfc,
        razonSocial: profile!.razonSocial,
        regimenFiscal: profile!.regimenFiscal,
        codigoPostal: profile!.codigoPostal,
        usoCFDI: profile!.usoCFDI,
        emailFacturacion: profile!.emailFacturacion,
        publicGeneral: false,
      },
      profileValid: true,
    };
  }
  return { receiver: publicGeneralReceiver, profileValid: false };
}

export async function requestMembershipInvoiceFromTransaction(input: {
  transactionId: string;
  userId: string;
  metadata?: Record<string, unknown>;
}) {
  let transactionId: Types.ObjectId;
  try {
    transactionId = asObjectId(input.transactionId, 'transaction_id');
  } catch {
    return { status: 400, body: { error: 'invalid_transaction_id' } };
  }

  const transaction = await MembershipPaymentTransaction.findOne({
    _id: transactionId,
    userId: asObjectId(input.userId, 'user_id'),
    status: 'payment_confirmed',
  });
  if (!transaction) return { status: 404, body: { error: 'payment_transaction_not_found' } };

  const settled: PaymentSettled = {
    transactionId: transaction._id,
    userId: transaction.userId,
    membershipId: transaction.membershipId,
    amount: transaction.amount,
    currency: transaction.currency,
    paidAt: transaction.processedAt,
  };
  const invoice = await handlePaymentSettled(settled, input.metadata);
  return { status: invoice.alreadyExists ? 200 : invoice.status === 'failed' ? 202 : 201, body: { invoice: invoice.record } };
}

export async function handlePaymentSettled(event: PaymentSettled, metadata: Record<string, unknown> = {}) {
  const existing = await InvoiceRecord.findOne({
    transactionId: event.transactionId,
    membershipId: event.membershipId,
    status: { $in: ['pending', 'processing', 'issued', 'cancel_requested', 'cancel_processing', 'failed', 'cancel_failed'] },
  });
  if (existing) return { record: existing, alreadyExists: true, status: existing.status };

  const { receiver, profileValid } = await resolveReceiver(event.userId);
  const invoice = await InvoiceRecord.create({
    transactionId: event.transactionId,
    membershipId: event.membershipId,
    userId: event.userId,
    status: 'pending',
    lifecycleStatus: 'pending',
    attempts: 0,
    retryCount: 0,
    amount: event.amount,
    currency: event.currency,
    provider: 'facturama',
    receiver,
    fiscalTrace: {
      paymentSettledAt: event.paidAt,
      profileValid,
      publicGeneral: receiver.publicGeneral,
      source: 'membership_payment_settled',
    },
  });

  await audit(String(event.userId), fiscalMembershipAuditActions.invoiceRequested, invoice._id, event.transactionId);
  await history(invoice, fiscalMembershipAuditActions.invoiceRequested, {
    transactionId: String(event.transactionId),
    membershipId: String(event.membershipId),
    state: 'pending',
  });
  await notify(event.userId, 'invoice_pending', 'Factura pendiente', 'Tu factura de membresía está en proceso.');
  if (receiver.publicGeneral) {
    await audit(String(event.userId), fiscalMembershipAuditActions.publicGeneralInvoiceCreated, invoice._id, event.transactionId);
  }

  return processInvoice(invoice._id, metadata);
}

export async function processInvoice(invoiceId: string | Types.ObjectId, metadata: Record<string, unknown> = {}) {
  const invoice = await InvoiceRecord.findById(invoiceId);
  if (!invoice) throw new Error('invoice_not_found');
  if (invoice.status === 'issued') return { record: invoice, alreadyExists: true, status: invoice.status };

  invoice.status = 'processing';
  invoice.lifecycleStatus = 'issuing';
  invoice.attempts += 1;
  invoice.processedAt = new Date();
  invoice.lastError = undefined;
  await invoice.save();
  await audit(String(invoice.userId), fiscalMembershipAuditActions.invoiceProcessingStarted, invoice._id, invoice.transactionId);
  await history(invoice, fiscalMembershipAuditActions.invoiceProcessingStarted, { state: 'processing', attempts: invoice.attempts });

  const provider = getMembershipFiscalProvider(invoice.provider);
  try {
    const result = await provider.emitInvoice({
      transactionId: String(invoice.transactionId),
      membershipId: String(invoice.membershipId),
      userId: String(invoice.userId),
      amount: invoice.amount || 0,
      currency: invoice.currency || 'MXN',
      receiver: invoice.receiver as any,
      metadata: safeProviderMetadata(metadata),
    });

    invoice.status = 'issued';
    invoice.lifecycleStatus = 'issued';
    invoice.invoiceUUID = result.uuid;
    invoice.xmlUrl = result.xmlUrl;
    invoice.pdfUrl = result.pdfUrl;
    invoice.issuedAt = new Date();
    invoice.providerReference = result.providerReference;
    invoice.providerRequestId = result.providerRequestId;
    invoice.providerName = provider.name;
    invoice.providerStatus = 'issued';
    invoice.providerMessage = 'issued';
    invoice.fiscalTrace = {
      ...(invoice.fiscalTrace || {}),
      uuidCfdi: result.uuid,
      xmlVersion: result.xmlVersion,
      pdfVersion: result.pdfVersion,
      issuedAt: invoice.issuedAt,
    };
    await invoice.save();
    await audit(String(invoice.userId), fiscalMembershipAuditActions.invoiceIssued, invoice._id, invoice.transactionId);
    await history(invoice, fiscalMembershipAuditActions.invoiceIssued, {
      uuidCfdi: result.uuid,
      provider: provider.name,
      xmlVersion: result.xmlVersion,
      pdfVersion: result.pdfVersion,
      issuedAt: invoice.issuedAt,
    });
    await notify(invoice.userId!, 'invoice_issued', 'Factura emitida', 'Tu factura de membresía fue emitida.');
    return { record: invoice, alreadyExists: false, status: invoice.status };
  } catch (error) {
    const reason = error instanceof FiscalProviderError ? error.reason : error instanceof Error ? error.message : String(error);
    invoice.status = 'failed';
    invoice.lifecycleStatus = 'failed';
    invoice.lastError = reason;
    invoice.providerStatus = 'failed';
    invoice.providerMessage = reason;
    await invoice.save();
    await audit(String(invoice.userId), reason === 'pac_timeout' ? fiscalMembershipAuditActions.providerTimeout : fiscalMembershipAuditActions.providerError, invoice._id, invoice.transactionId);
    await audit(String(invoice.userId), fiscalMembershipAuditActions.invoiceFailed, invoice._id, invoice.transactionId);
    await history(invoice, fiscalMembershipAuditActions.invoiceFailed, { reason, state: 'failed' });
    await notify(invoice.userId!, 'invoice_failed', 'Factura pendiente de recuperación', 'Tu pago fue confirmado, pero la factura requiere reintento fiscal.');
    return { record: invoice, alreadyExists: false, status: invoice.status };
  }
}

export async function getMembershipInvoiceForUser(id: string, userId: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  return InvoiceRecord.findOne({ _id: id, userId }).lean();
}

export async function listMembershipFiscalHistory(userId: string) {
  return InvoiceHistory.find({ userId: asObjectId(userId, 'user_id') }).sort({ timestamp: -1 }).lean();
}

export async function cancelMembershipInvoice(input: {
  invoiceId: string;
  userId: string;
  reason: string;
  metadata?: Record<string, unknown>;
}) {
  const invoice = await InvoiceRecord.findOne({ _id: asObjectId(input.invoiceId, 'invoice_id'), userId: asObjectId(input.userId, 'user_id') });
  if (!invoice) return { status: 404, body: { error: 'invoice_not_found' } };
  if (invoice.status !== 'issued' || !invoice.invoiceUUID) return { status: 409, body: { error: 'invoice_not_issued' } };

  invoice.status = 'cancel_requested';
  invoice.lifecycleStatus = 'cancel_requested';
  invoice.cancellationReason = input.reason;
  await invoice.save();
  await audit(input.userId, fiscalMembershipAuditActions.invoiceCancelRequested, invoice._id, invoice.transactionId);
  await history(invoice, fiscalMembershipAuditActions.invoiceCancelRequested, { reason: input.reason, state: 'cancel_requested' });

  invoice.status = 'cancel_processing';
  invoice.lifecycleStatus = 'cancel_processing';
  await invoice.save();
  await history(invoice, 'INVOICE_CANCEL_PROCESSING_STARTED', { state: 'cancel_processing' });

  const provider = getMembershipFiscalProvider(invoice.provider);
  try {
    const result = await provider.cancelInvoice({
      invoiceUUID: invoice.invoiceUUID,
      reason: input.reason,
      metadata: safeProviderMetadata(input.metadata),
    });
    invoice.status = 'cancelled';
    invoice.lifecycleStatus = 'cancelled';
    invoice.cancelledAt = result.cancelledAt;
    invoice.providerReference = result.providerReference;
    invoice.providerRequestId = result.providerRequestId;
    invoice.providerStatus = 'cancelled';
    invoice.providerMessage = 'cancelled';
    invoice.fiscalTrace = {
      ...(invoice.fiscalTrace || {}),
      cancelledAt: invoice.cancelledAt,
      cancellationReason: input.reason,
    };
    await invoice.save();
    await audit(input.userId, fiscalMembershipAuditActions.invoiceCancelled, invoice._id, invoice.transactionId);
    await history(invoice, fiscalMembershipAuditActions.invoiceCancelled, { reason: input.reason, cancelledAt: invoice.cancelledAt });
    await notify(invoice.userId!, 'invoice_cancelled', 'Factura cancelada', 'Tu factura de membresía fue cancelada.');
    return { status: 200, body: { invoice } };
  } catch (error) {
    const reason = error instanceof FiscalProviderError ? error.reason : error instanceof Error ? error.message : String(error);
    invoice.status = 'cancel_failed';
    invoice.lifecycleStatus = 'cancel_failed';
    invoice.lastError = reason;
    invoice.providerStatus = 'failed';
    invoice.providerMessage = reason;
    await invoice.save();
    await audit(input.userId, fiscalMembershipAuditActions.invoiceCancelFailed, invoice._id, invoice.transactionId);
    await history(invoice, fiscalMembershipAuditActions.invoiceCancelFailed, { reason, state: 'cancel_failed' });
    return { status: 422, body: { error: reason, invoice } };
  }
}

export async function listAdminMembershipInvoices(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
  const filter: Record<string, unknown> = { membershipId: { $exists: true } };
  if (query.status) filter.status = String(query.status);
  const [items, total] = await Promise.all([
    InvoiceRecord.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    InvoiceRecord.countDocuments(filter),
  ]);
  return { items, page, limit, total };
}

export async function getAdminMembershipInvoice(id: string) {
  if (!Types.ObjectId.isValid(id)) return null;
  return InvoiceRecord.findOne({ _id: id, membershipId: { $exists: true } }).lean();
}

export async function listFailedMembershipInvoices() {
  return InvoiceRecord.find({ membershipId: { $exists: true }, status: { $in: ['failed', 'cancel_failed'] } })
    .sort({ updatedAt: -1 })
    .lean();
}

export async function reprocessMembershipInvoice(id: string, metadata: Record<string, unknown> = {}) {
  if (!Types.ObjectId.isValid(id)) return { status: 400, body: { error: 'invalid_invoice_id' } };
  const invoice = await InvoiceRecord.findOne({ _id: id, membershipId: { $exists: true } });
  if (!invoice) return { status: 404, body: { error: 'invoice_not_found' } };
  if (!['failed', 'cancel_failed'].includes(invoice.status)) return { status: 409, body: { error: 'invoice_not_reprocessable' } };
  if (invoice.status === 'cancel_failed') return cancelMembershipInvoice({
    invoiceId: String(invoice._id),
    userId: String(invoice.userId),
    reason: invoice.cancellationReason || '02',
    metadata,
  });

  invoice.retryCount = (invoice.retryCount || 0) + 1;
  await invoice.save();
  await history(invoice, 'INVOICE_RETRY_EXECUTED', { retryCount: invoice.retryCount });
  const result = await processInvoice(invoice._id, metadata);
  return { status: result.status === 'issued' ? 200 : 202, body: { invoice: result.record } };
}
