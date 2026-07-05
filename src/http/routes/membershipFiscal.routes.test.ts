import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../../app';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
import { InvoiceHistory } from '../../domain/invoiceRecords/invoiceHistory.model';
import { InvoiceRecord } from '../../domain/invoiceRecords/invoiceRecord.model';
import { MembershipPlan } from '../../domain/memberships/membershipPlan.model';
import { createMembership } from '../../domain/memberships/membershipFoundation.service';
import { Notification } from '../../domain/notifications/notification.model';
import { MembershipPaymentTransaction } from '../../domain/payments/membershipPaymentTransaction.model';
import { handlePaymentSettled } from '../../domain/fiscalMembership/fiscalMembership.service';
import { bearer } from '../../test/helpers/auth';
import { createTestUser } from '../../test/helpers/factories';
import { signAccessToken } from '../../utils/jwt';

function tokenFor(user: any, role: 'user' | 'admin' | 'super' = user.role || 'user') {
  return signAccessToken({ sub: String(user._id), role, typ: 'access' });
}

async function createPlan() {
  const suffix = Math.random().toString(36).slice(2, 8);
  return MembershipPlan.create({
    code: `fiscal-professional-${suffix}`,
    name: 'Professional Fiscal',
    description: 'Professional fiscal plan',
    monthlyPrice: 1500,
    yearlyPrice: 15000,
    durationDays: 30,
    price: 1500,
    currency: 'MXN',
    billingPeriod: 'manual',
    benefits: {
      maxActiveListings: 25,
      maxPhotosPerListing: 20,
      canUseFeaturedListings: true,
      includedFeaturedListings: 5,
      canAccessAuctions: true,
      canAccessMetrics: false,
      supportLevel: 'priority',
    },
    limits: { animalListings: 25, auctionListings: 10, mediaUploads: 100, messaging: 500, featuredPublications: 5 },
    isActive: true,
    isPublic: true,
  });
}

async function createPaidMembershipTransaction(user: any, amount = 1500) {
  const plan = await createPlan();
  const membership = await createMembership({ userId: String(user._id), planId: String(plan._id) }, String(user._id));
  const suffix = Math.random().toString(36).slice(2, 10);
  return MembershipPaymentTransaction.create({
    userId: user._id,
    planId: plan._id,
    membershipId: membership._id,
    stripeCheckoutSessionId: `cs_fiscal_${suffix}`,
    stripePaymentIntentId: `pi_fiscal_${suffix}`,
    stripeEventId: `evt_fiscal_${suffix}`,
    status: 'payment_confirmed',
    amount,
    currency: 'MXN',
    processedAt: new Date(),
    metadata: { source: 'fiscal_test' },
  });
}

async function createValidatedFiscalProfile(user: any) {
  return FiscalProfile.create({
    userId: user._id,
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    codigoPostal: '83200',
    usoCFDI: 'G03',
    emailFacturacion: 'facturacion@example.test',
    isValidated: true,
  });
}

describe('membership fiscal compliance 13.2C', () => {
  it('creates and updates fiscal profile with audit and rejects invalid payload', async () => {
    const user = await createTestUser('user');

    await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ rfc: 'bad', razonSocial: 'Bad', regimenFiscal: '601', codigoPostal: '83200', usoCFDI: 'G03' })
      .expect(400);

    await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(tokenFor(user)))
      .send({
        rfc: 'EKU9003173C9',
        razonSocial: 'Escuela Kemper Urgate',
        regimenFiscal: '601',
        codigoPostal: '83200',
        usoCFDI: 'G03',
        emailFacturacion: 'fiscal@example.test',
      })
      .expect(200);

    await request(app)
      .post('/account/fiscal-profile')
      .set('Authorization', bearer(tokenFor(user)))
      .send({
        rfc: 'EKU9003173C9',
        razonSocial: 'Escuela Kemper Actualizada',
        regimenFiscal: '601',
        codigoPostal: '83200',
        usoCFDI: 'G03',
      })
      .expect(200);

    expect(await Audit.exists({ actor: String(user._id), action: 'FISCAL_PROFILE_CREATED' })).toBeTruthy();
    expect(await Audit.exists({ actor: String(user._id), action: 'FISCAL_PROFILE_UPDATED' })).toBeTruthy();
  });

  it('generates a public general membership invoice when the user has no validated fiscal profile', async () => {
    const user = await createTestUser('user');
    const tx = await createPaidMembershipTransaction(user);

    const res = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id) })
      .expect(201);

    expect(res.body.invoice.status).toBe('issued');
    expect(res.body.invoice.receiver.rfc).toBe('XAXX010101000');
    expect(res.body.invoice.receiver.publicGeneral).toBe(true);
    expect(res.body.invoice.invoiceUUID).toBeTruthy();
    expect(await Audit.exists({ action: 'PUBLIC_GENERAL_INVOICE_CREATED', invoiceRecordId: res.body.invoice._id })).toBeTruthy();
    expect(await Notification.exists({ userId: user._id, type: 'invoice_issued' })).toBeTruthy();
  });

  it('uses a validated fiscal profile, stores history, and allows user reads', async () => {
    const user = await createTestUser('user');
    await createValidatedFiscalProfile(user);
    const tx = await createPaidMembershipTransaction(user);

    const res = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id) })
      .expect(201);

    expect(res.body.invoice.receiver.publicGeneral).toBe(false);
    expect(res.body.invoice.receiver.rfc).toBe('EKU9003173C9');
    expect(res.body.invoice.xmlUrl).toContain('facturama://xml/');
    expect(res.body.invoice.pdfUrl).toContain('facturama://pdf/');

    await request(app)
      .get(`/fiscal/memberships/invoice/${res.body.invoice._id}`)
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);

    const history = await request(app)
      .get('/fiscal/memberships/history')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(200);

    expect(history.body.items.map((item: any) => item.event)).toContain('INVOICE_ISSUED');
    expect(await InvoiceHistory.exists({ invoiceId: res.body.invoice._id, event: 'INVOICE_PROCESSING_STARTED' })).toBeTruthy();
  });

  it('is idempotent and prevents duplicate active CFDI for the same commercial transaction', async () => {
    const user = await createTestUser('user');
    const tx = await createPaidMembershipTransaction(user);

    const first = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id) })
      .expect(201);

    const second = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id) })
      .expect(200);

    expect(second.body.invoice._id).toBe(first.body.invoice._id);
    expect(await InvoiceRecord.countDocuments({ transactionId: tx._id })).toBe(1);
  });

  it('keeps payment success valid when PAC fails and supports safe admin retry', async () => {
    const user = await createTestUser('user');
    const admin = await createTestUser('admin');
    const tx = await createPaidMembershipTransaction(user);

    const failed = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id), metadata: { providerMode: 'pac_down', token: 'secret-token' } })
      .expect(202);

    expect(failed.body.invoice.status).toBe('failed');
    expect(failed.body.invoice.lastError).toBe('pac_down');
    expect(await Audit.exists({ action: 'FISCAL_PROVIDER_ERROR', invoiceRecordId: failed.body.invoice._id })).toBeTruthy();

    const retry = await request(app)
      .post(`/admin/fiscal/reprocess/${failed.body.invoice._id}`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .send({ metadata: { providerMode: 'success' } })
      .expect(200);

    expect(retry.body.invoice.status).toBe('issued');
    expect(retry.body.invoice.retryCount).toBe(1);
    expect(JSON.stringify(retry.body)).not.toContain('secret-token');
  });

  it('records PAC timeout, timbrado/SAT/XML/PDF failures as recoverable invoice failures', async () => {
    const modes = ['pac_timeout', 'timbrado_rejected', 'sat_error', 'xml_unavailable', 'pdf_unavailable'];
    for (const mode of modes) {
      const user = await createTestUser('user');
      const tx = await createPaidMembershipTransaction(user);
      const result = await handlePaymentSettled({
        transactionId: tx._id,
        userId: tx.userId,
        membershipId: tx.membershipId,
        amount: tx.amount,
        currency: tx.currency,
        paidAt: tx.processedAt,
      }, { providerMode: mode });
      expect(result.status).toBe('failed');
      expect(result.record.lastError).toBe(mode);
    }
    expect(await Audit.exists({ action: 'FISCAL_PROVIDER_TIMEOUT' })).toBeTruthy();
  });

  it('runs non-instant cancellation lifecycle and handles cancellation provider errors', async () => {
    const user = await createTestUser('user');
    const tx = await createPaidMembershipTransaction(user);
    const issued = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id) })
      .expect(201);

    const cancelled = await request(app)
      .post(`/fiscal/memberships/invoice/${issued.body.invoice._id}/cancel`)
      .set('Authorization', bearer(tokenFor(user)))
      .send({ reason: '02' })
      .expect(200);

    expect(cancelled.body.invoice.status).toBe('cancelled');
    expect(cancelled.body.invoice.cancelledAt).toBeTruthy();
    expect(await Audit.exists({ action: 'INVOICE_CANCEL_REQUESTED', invoiceRecordId: issued.body.invoice._id })).toBeTruthy();
    expect(await Audit.exists({ action: 'INVOICE_CANCELLED', invoiceRecordId: issued.body.invoice._id })).toBeTruthy();

    const other = await createTestUser('user');
    const otherTx = await createPaidMembershipTransaction(other);
    const otherInvoice = await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(other)))
      .send({ transactionId: String(otherTx._id) })
      .expect(201);

    const failedCancel = await request(app)
      .post(`/fiscal/memberships/invoice/${otherInvoice.body.invoice._id}/cancel`)
      .set('Authorization', bearer(tokenFor(other)))
      .send({ reason: '02', metadata: { providerMode: 'cancellation_rejected' } })
      .expect(422);

    expect(failedCancel.body.invoice.status).toBe('cancel_failed');
    expect(await Audit.exists({ action: 'INVOICE_CANCEL_FAILED', invoiceRecordId: otherInvoice.body.invoice._id })).toBeTruthy();
  });

  it('exposes admin fiscal lists, failed list and Admin Control Center aggregate metrics only', async () => {
    const user = await createTestUser('user');
    const admin = await createTestUser('admin');
    const tx = await createPaidMembershipTransaction(user);

    await request(app)
      .post('/fiscal/memberships/invoice')
      .set('Authorization', bearer(tokenFor(user)))
      .send({ transactionId: String(tx._id), metadata: { providerMode: 'sat_error' } })
      .expect(202);

    const list = await request(app)
      .get('/admin/fiscal/invoices')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(list.body.items.length).toBeGreaterThanOrEqual(1);

    const failed = await request(app)
      .get('/admin/fiscal/failed')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);
    expect(failed.body.items.length).toBeGreaterThanOrEqual(1);

    await request(app)
      .get(`/admin/fiscal/invoices/${failed.body.items[0]._id}`)
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    await request(app)
      .get('/admin/fiscal/invoices')
      .set('Authorization', bearer(tokenFor(user)))
      .expect(403);

    const dashboard = await request(app)
      .get('/admin/control-center/dashboard')
      .set('Authorization', bearer(tokenFor(admin, 'admin')))
      .expect(200);

    expect(dashboard.body.fiscalMembership.invoicesFailed).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.fiscalMembership.providerErrors).toBeGreaterThanOrEqual(1);
    expect(dashboard.body.fiscalMembership).not.toHaveProperty('invoices');
  });
});
