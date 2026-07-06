import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { CommercialOperation } from '../../domain/payments/commercialOperation.model';
import { PaymentSettlement } from '../../domain/payments/paymentSettlement.model';
import { PaymentTransaction } from '../../domain/payments/paymentTransaction.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { RefundRecord } from '../../domain/payments/refundRecord.model';
import { ReconciliationRecord } from '../../domain/payments/reconciliationRecord.model';
import {
  commercialRevenueAuditActions,
  createPaymentWebhookSignature,
} from '../../domain/payments/commercialRevenue.service';
import { Notification } from '../../domain/notifications/notification.model';
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

async function createOperation(token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/payments/operations')
    .set('Authorization', bearer(token))
    .send({
      operationType: 'membership',
      referenceType: 'membership',
      referenceId: `ref-${Math.random().toString(36).slice(2, 8)}`,
      amount: 499,
      currency: 'MXN',
      metadata: { source: 'test', token: 'must-not-persist' },
      ...overrides,
    })
    .expect(201);
  return res.body;
}

async function checkout(token: string, operationId: string) {
  const res = await request(app)
    .post('/payments/checkout')
    .set('Authorization', bearer(token))
    .send({ operationId })
    .expect(201);
  return res.body;
}

function settleWebhook(operation: any, transaction: any, eventId = 'evt_settled_1') {
  const payload = {
    id: eventId,
    type: 'payment.settled',
    data: {
      object: {
        operationId: operation._id,
        paymentIntentId: transaction.providerPaymentIntentId,
        settledAt: '2026-07-05T12:00:00.000Z',
      },
    },
  };
  const raw = JSON.stringify(payload);
  return request(app)
    .post('/payments/webhook')
    .set('Content-Type', 'application/json')
    .set('x-payment-signature', createPaymentWebhookSignature(raw))
    .send(raw);
}

describe('Commercial Revenue Platform 13.5', () => {
  it('creates CommercialOperation with operationNumber, validates operationType, sanitizes metadata and audits', async () => {
    const { user, token } = await userContext();
    const first = await createOperation(token);
    const second = await createOperation(token, { referenceId: 'second-ref' });

    expect(first.operationNumber).toMatch(/^EG-\d{4}-000000001$/);
    expect(second.operationNumber).toMatch(/^EG-\d{4}-000000002$/);
    expect(first.operationType).toBe('membership');
    expect(first.status).toBe('created');
    expect(first.metadata).toEqual({ source: 'test' });

    await request(app)
      .post('/payments/operations')
      .set('Authorization', bearer(token))
      .send({ operationType: 'advertising', referenceType: 'ad', referenceId: 'ad-1', amount: 100 })
      .expect(409);

    await request(app)
      .post('/payments/operations')
      .set('Authorization', bearer(token))
      .send({ operationType: 'invalid', referenceType: 'x', referenceId: 'x', amount: 100 })
      .expect(400);

    const audit = await Audit.findOne({
      actor: String(user._id),
      action: commercialRevenueAuditActions.commercialOperationCreated,
    });
    expect(audit).toBeTruthy();
  });

  it('creates Revenue-owned checkout and payment transaction without exposing provider states', async () => {
    const { token } = await userContext();
    const operation = await createOperation(token);
    const transaction = await checkout(token, operation._id);

    expect(transaction.providerPaymentIntentId).toMatch(/^pi_/);
    expect(transaction.providerCheckoutId).toMatch(/^chk_/);
    expect(transaction.checkoutUrl).toContain('/checkout/');
    expect(transaction.status).toBe('checkout_created');

    const storedOperation = await CommercialOperation.findById(operation._id).lean();
    expect(storedOperation?.status).toBe('checkout_pending');

    await request(app)
      .get(`/payments/operations/${operation._id}`)
      .set('Authorization', bearer(token))
      .expect(200);
    await request(app)
      .get('/payments/transactions')
      .set('Authorization', bearer(token))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
      });
  });

  it('validates webhook signature, persists log, emits PaymentSettled once and ignores duplicates', async () => {
    const { user, token } = await userContext();
    const operation = await createOperation(token);
    const transaction = await checkout(token, operation._id);

    await request(app)
      .post('/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payment-signature', 'bad')
      .send(Buffer.from('{}'))
      .expect(400);

    await settleWebhook(operation, transaction).expect(200);
    await settleWebhook(operation, transaction).expect(200).expect((res) => {
      expect(res.body.duplicate).toBe(true);
    });

    expect(await PaymentSettlement.countDocuments({ operationId: operation._id })).toBe(1);
    expect(await PaymentWebhookLog.countDocuments({ providerEventId: 'evt_settled_1', processed: true })).toBe(1);
    expect(await Audit.countDocuments({ action: commercialRevenueAuditActions.paymentSettled })).toBe(1);
    expect(await Notification.countDocuments({ userId: user._id, type: 'payment_settled' })).toBe(1);

    const storedOperation = await CommercialOperation.findById(operation._id).lean();
    const storedTransaction = await PaymentTransaction.findById(transaction._id).lean();
    expect(storedOperation?.status).toBe('settled');
    expect(storedTransaction?.status).toBe('settled');
  });

  it('processes refunds only after settlement and records rejected refund attempts', async () => {
    const { token } = await userContext();
    const pending = await createOperation(token, { referenceId: 'pending-refund' });

    await request(app)
      .post('/payments/refunds')
      .set('Authorization', bearer(token))
      .send({ operationId: pending._id, reason: 'business_rejected' })
      .expect(409);
    expect(await RefundRecord.countDocuments({ operationId: pending._id, status: 'rejected' })).toBe(1);

    const settled = await createOperation(token, { referenceId: 'settled-refund' });
    const transaction = await checkout(token, settled._id);
    await settleWebhook(settled, transaction, 'evt_settled_refund').expect(200);

    await request(app)
      .post('/payments/refunds')
      .set('Authorization', bearer(token))
      .send({ operationId: settled._id, reason: 'business_approved' })
      .expect(201)
      .expect((res) => {
        expect(res.body.ok).toBe(true);
        expect(res.body.refund.status).toBe('processed');
      });

    expect(await Audit.countDocuments({ action: commercialRevenueAuditActions.paymentRefunded })).toBe(1);
    expect(await Notification.countDocuments({ type: 'refund_processed' })).toBe(1);
  });

  it('runs reconciliation, exposes admin metrics and keeps adjacent domains compatible', async () => {
    const { token } = await userContext();
    const admin = await userContext('admin');
    const operation = await createOperation(token, { referenceId: 'reconcile-ref' });
    await checkout(token, operation._id);

    await request(app)
      .post('/admin/payments/reconcile')
      .set('Authorization', bearer(token))
      .send({})
      .expect(403);

    await request(app)
      .post('/admin/payments/reconcile')
      .set('Authorization', bearer(admin.token))
      .send({})
      .expect(201)
      .expect((res) => {
        expect(res.body.status).toBe('completed');
        expect(res.body.pendingPayments).toBeGreaterThanOrEqual(1);
      });

    await request(app)
      .get('/admin/payments/reconciliation')
      .set('Authorization', bearer(admin.token))
      .expect(200)
      .expect((res) => {
        expect(res.body.total).toBe(1);
      });

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(admin.token))
      .expect(200);
    expect(dashboard.body.commercialRevenue).toMatchObject({
      operationsCreated: 1,
      paymentsCreated: 1,
      reconciliationsExecuted: 1,
    });

    expect(await ReconciliationRecord.countDocuments()).toBe(1);
    expect(await Audit.countDocuments({ action: commercialRevenueAuditActions.reconciliationCompleted })).toBe(1);

    await request(app).get('/account/membership').set('Authorization', bearer(token)).expect(200);
    await request(app).get('/catalog/listings').expect(200);
    await request(app).get('/admin/aoe/operational-decisions').set('Authorization', bearer(admin.token)).expect(200);
    await request(app).get('/admin/knowledge/records').set('Authorization', bearer(admin.token)).expect(200);
  });
});
