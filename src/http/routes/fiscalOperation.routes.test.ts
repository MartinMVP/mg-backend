import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { CommercialOperation } from '../../domain/payments/commercialOperation.model';
import { PaymentSettlement } from '../../domain/payments/paymentSettlement.model';
import { PaymentTransaction } from '../../domain/payments/paymentTransaction.model';
import { FiscalOperation } from '../../domain/fiscalOperations/fiscalOperation.model';
import { FiscalOperationHistory } from '../../domain/fiscalOperations/fiscalOperationHistory.model';
import {
  executeFiscalRecovery,
  fiscalPlatformAuditActions,
} from '../../domain/fiscalOperations/fiscalPlatform.service';
import {
  FacturamaPlatformProvider,
  FuturePlatformProvider,
  MockFiscalPlatformProvider,
  resolveFiscalPlatformProvider,
} from '../../domain/fiscalOperations/fiscalPlatformProvider';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

function tokenFor(user: any, role = user.role) {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function userContext(role: 'user' | 'admin' | 'super' = 'user') {
  const user = await createTestUser(role);
  return { user, token: tokenFor(user, role) };
}

async function settledCommercialOperation(createdBy?: any) {
  const operation = await CommercialOperation.create({
    operationNumber: `EG-2026-${Math.floor(Math.random() * 999999999).toString().padStart(9, '0')}`,
    operationType: 'membership',
    referenceType: 'membership',
    referenceId: `membership-${Math.random().toString(36).slice(2, 8)}`,
    amount: 499,
    currency: 'MXN',
    status: 'settled',
    createdBy: createdBy?._id,
  });
  const transaction = await PaymentTransaction.create({
    operationId: operation._id,
    operationNumber: operation.operationNumber,
    provider: 'internal',
    providerPaymentIntentId: `pi_${Math.random().toString(36).slice(2, 12)}`,
    amount: operation.amount,
    currency: operation.currency,
    status: 'settled',
  });
  await PaymentSettlement.create({
    operationId: operation._id,
    operationNumber: operation.operationNumber,
    operationType: operation.operationType,
    referenceType: operation.referenceType,
    referenceId: operation.referenceId,
    amount: operation.amount,
    currency: operation.currency,
    paymentTransactionId: transaction._id,
    providerEventId: `evt_${Math.random().toString(36).slice(2, 12)}`,
    settledAt: new Date(),
  });
  return operation;
}

function createFiscal(token: string, operation: any, metadata: Record<string, unknown> = {}) {
  return request(app)
    .post('/fiscal/operations')
    .set('Authorization', bearer(token))
    .send({ commercialOperationId: String(operation._id), provider: 'mock', metadata });
}

describe('Fiscal Platform 13.6', () => {
  it('creates FiscalOperation from PaymentSettled, stamps, delivers, audits and preserves reproducible history', async () => {
    const { user, token } = await userContext();
    const operation = await settledCommercialOperation(user);

    const res = await createFiscal(token, operation)
      .expect(201)
      .expect((response) => {
        expect(response.body.commercialOperationId).toBe(String(operation._id));
        expect(response.body.invoiceStatus).toBe('delivered');
        expect(response.body.uuid).toMatch(/^uuid-/);
        expect(response.body.xmlLocation).toContain('.xml');
        expect(response.body.pdfLocation).toContain('.pdf');
      });

    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.fiscalOperationCreated })).toBe(1);
    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceStamped })).toBe(1);
    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceDelivered })).toBe(1);

    const history = await request(app)
      .get(`/fiscal/history/${operation._id}`)
      .set('Authorization', bearer(token))
      .expect(200);
    expect(history.body.operation.uuid).toBe(res.body.uuid);
    expect(history.body.items.map((item: any) => item.event)).toEqual(expect.arrayContaining([
      'FISCAL_OPERATION_CREATED',
      'INVOICE_STAMPED',
      'INVOICE_DELIVERED',
    ]));
  });

  it('is idempotent for repeated fiscal emission requests and requires PaymentSettled', async () => {
    const { token } = await userContext();
    const unsettled = await CommercialOperation.create({
      operationNumber: 'EG-2026-000111111',
      operationType: 'membership',
      referenceType: 'membership',
      referenceId: 'unsettled',
      amount: 100,
      currency: 'MXN',
      status: 'created',
    });
    await createFiscal(token, unsettled).expect(409);

    const operation = await settledCommercialOperation();
    const first = await createFiscal(token, operation).expect(201);
    const second = await createFiscal(token, operation).expect(200);
    expect(second.body._id).toBe(first.body._id);
    expect(await FiscalOperation.countDocuments({ commercialOperationId: operation._id })).toBe(1);
  });

  it('does not duplicate FiscalOperation when PaymentSettled exists once and create is called twice', async () => {
    const { token } = await userContext();
    const operation = await settledCommercialOperation();

    await createFiscal(token, operation).expect(201);
    await createFiscal(token, operation).expect(200);

    expect(await PaymentSettlement.countDocuments({ operationId: operation._id })).toBe(1);
    expect(await FiscalOperation.countDocuments({ commercialOperationId: operation._id })).toBe(1);
  });

  it('protects PaymentSettled retries and concurrent fiscal creation from duplicate CFDI emission', async () => {
    const { token } = await userContext();
    const operation = await settledCommercialOperation();
    const emitSpy = vi.spyOn(MockFiscalPlatformProvider.prototype, 'emitInvoice');

    try {
      const responses = await Promise.all([
        createFiscal(token, operation),
        createFiscal(token, operation),
        createFiscal(token, operation),
      ]);

      expect(responses.map((response) => response.status).sort()).toEqual([200, 200, 201]);
      expect(new Set(responses.map((response) => response.body._id)).size).toBe(1);
      expect(await FiscalOperation.countDocuments({ commercialOperationId: operation._id })).toBe(1);
      expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceStamped })).toBe(1);
      expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceDelivered })).toBe(1);
      expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.fiscalOperationDuplicateIgnored })).toBe(2);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('records PAC rejection as failed and does not retry definitive fiscal errors automatically', async () => {
    const { token } = await userContext();
    const operation = await settledCommercialOperation();

    await createFiscal(token, operation, { forceProviderReject: true })
      .expect(201)
      .expect((res) => {
        expect(res.body.invoiceStatus).toBe('failed');
        expect(res.body.transientError).toBe(false);
        expect(res.body.lastError).toBe('fiscal_data_rejected');
      });

    const recovery = await executeFiscalRecovery('system');
    expect(recovery.candidates).toBe(0);
    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.fiscalRecoveryExecuted })).toBe(1);
  });

  it('models cancellation as request, provider confirmation and internal update', async () => {
    const { user, token } = await userContext();
    const operation = await settledCommercialOperation(user);
    const fiscal = await createFiscal(token, operation).expect(201);

    await request(app)
      .post(`/fiscal/invoices/${fiscal.body._id}/cancel`)
      .set('Authorization', bearer(token))
      .send({ reason: '02' })
      .expect(200)
      .expect((res) => {
        expect(res.body.ok).toBe(true);
        expect(res.body.operation.invoiceStatus).toBe('cancelled');
        expect(res.body.operation.cancellationRequestedBy).toBe(String(user._id));
        expect(res.body.operation.cancelledAt).toBeTruthy();
      });

    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceCancelRequested })).toBe(1);
    expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceCancelled })).toBe(1);
    expect(await FiscalOperationHistory.countDocuments({ event: 'INVOICE_CANCEL_REQUESTED' })).toBe(1);
    expect(await FiscalOperationHistory.countDocuments({ event: 'INVOICE_CANCELLED' })).toBe(1);
  });

  it('recovers temporary provider failures through FiscalRecoveryService', async () => {
    const { token } = await userContext();
    const operation = await settledCommercialOperation();

    await createFiscal(token, operation, { forceTemporaryError: true })
      .expect(201)
      .expect((res) => {
        expect(res.body.invoiceStatus).toBe('failed');
        expect(res.body.transientError).toBe(true);
      });

    const recovery = await executeFiscalRecovery('system');
    expect(recovery).toMatchObject({ candidates: 1, recovered: 1 });
    const recovered = await FiscalOperation.findOne({ commercialOperationId: operation._id }).lean();
    expect(recovered?.invoiceStatus).toBe('delivered');
  });

  it('reuses the failed FiscalOperation during concurrent recovery without duplicate CFDI emission', async () => {
    const { token } = await userContext();
    const operation = await settledCommercialOperation();
    const emitSpy = vi.spyOn(MockFiscalPlatformProvider.prototype, 'emitInvoice');

    try {
      await createFiscal(token, operation, { forceTemporaryError: true }).expect(201);
      expect(await FiscalOperation.countDocuments({ commercialOperationId: operation._id })).toBe(1);
      emitSpy.mockClear();

      await Promise.all([
        executeFiscalRecovery('system'),
        executeFiscalRecovery('system'),
      ]);

      const recovered = await FiscalOperation.findOne({ commercialOperationId: operation._id }).lean();
      expect(recovered?.invoiceStatus).toBe('delivered');
      expect(await FiscalOperation.countDocuments({ commercialOperationId: operation._id })).toBe(1);
      expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceStamped })).toBe(1);
      expect(await Audit.countDocuments({ action: fiscalPlatformAuditActions.invoiceDelivered })).toBe(1);
      expect(emitSpy).toHaveBeenCalledTimes(1);
    } finally {
      emitSpy.mockRestore();
    }
  });

  it('keeps FiscalProvider abstract and exposes admin fiscal invoices without breaking adjacent domains', async () => {
    const { token } = await userContext();
    const admin = await userContext('admin');
    const operation = await settledCommercialOperation();
    await createFiscal(token, operation).expect(201);

    expect(resolveFiscalPlatformProvider('mock')).toBeInstanceOf(MockFiscalPlatformProvider);
    expect(resolveFiscalPlatformProvider('facturama')).toBeInstanceOf(FacturamaPlatformProvider);
    expect(resolveFiscalPlatformProvider('future')).toBeInstanceOf(FuturePlatformProvider);

    await request(app)
      .get('/admin/fiscal/invoices')
      .set('Authorization', bearer(admin.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.items.some((item: any) => item.commercialOperationId === String(operation._id))).toBe(true);
      });

    await request(app).get('/account/membership').set('Authorization', bearer(token)).expect(200);
    await request(app).get('/catalog/listings').expect(200);
    await request(app).get('/admin/aoe/operational-decisions').set('Authorization', bearer(admin.token)).expect(200);
    await request(app).get('/admin/knowledge/records').set('Authorization', bearer(admin.token)).expect(200);
  });
});
