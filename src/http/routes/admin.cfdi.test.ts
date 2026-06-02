import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { buildCfdiRequest } from '../../domain/cfdi/cfdiRequest.builder';
import { CfdiRequest } from '../../domain/cfdi/cfdi.types';
import { validateCfdiRequest } from '../../domain/cfdi/cfdiValidator.service';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import * as providerRegistry from '../../domain/fiscalProviders/fiscalProvider.registry';
import { MockFiscalProvider } from '../../domain/fiscalProviders/mockFiscalProvider';
import { mapCfdiToProviderInvoiceRequest } from '../../domain/fiscalProviders/providerInvoice.mapper';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { processInvoiceQueue } from '../../domain/invoiceProcessing/invoiceProcessor.service';
import { InvoiceQueue } from '../../domain/invoiceQueue/invoiceQueue.model';
import { InvoiceRecord } from '../../domain/invoiceRecords/invoiceRecord.model';
import { Transaction } from '../../domain/transactions/transaction.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

function validCfdiRequest(overrides: Partial<CfdiRequest> = {}): CfdiRequest {
  return {
    transactionId: new Types.ObjectId(),
    invoiceRecordId: new Types.ObjectId(),
    issuer: {
      rfc: 'XAXX010101000',
      name: 'Vendedor Test',
      regimenFiscal: '601',
      postalCode: '83000',
    },
    receiver: {
      rfc: 'XEXX010101000',
      name: 'Comprador Test',
      regimenFiscal: '612',
      postalCode: '83100',
      usoCFDI: 'G03',
    },
    concepts: [
      {
        description: 'Operacion Mercado Ganadero',
        productServiceKey: '10101500',
        quantity: 1,
        unitKey: 'E48',
        unitPrice: 9000,
        amount: 9000,
        taxObject: '02',
      },
    ],
    totals: {
      subtotal: 9000,
      taxes: 0,
      total: 9000,
      currency: 'MXN',
    },
    currency: 'MXN',
    ...overrides,
  };
}

async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
  const user = await createTestUser(role);
  return createAccessToken(String(user._id), role);
}

async function createInvoiceRecordFixture() {
  const seller = await createTestUser('user');
  const buyer = await createTestUser('user');
  const listing = await createTestListing(seller._id);
  const auction = await createLiveAuction({
    listing: listing._id,
    state: 'closed',
    currentWinner: buyer._id,
    currentPrice: 9000,
    endsAt: new Date(Date.now() - 60_000),
  });
  const result = await AuctionResult.create({
    auctionId: auction._id,
    listingId: listing._id,
    sellerId: seller._id,
    buyerId: buyer._id,
    finalPrice: 9000,
    closedAt: new Date(),
    status: 'sale_confirmed',
  });
  const transaction = await Transaction.create({
    auctionResultId: result._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    amount: 9000,
    status: 'ready_for_invoice',
  });
  const snapshot = await FiscalSnapshot.create({
    transactionId: transaction._id,
    auctionResultId: result._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    buyerFiscalProfile: {
      rfc: 'XEXX010101000',
      razonSocial: 'Comprador Snapshot',
      regimenFiscal: '612',
      codigoPostal: '83100',
      usoCFDI: 'G03',
      emailFacturacion: 'buyer-snapshot@mg.test',
    },
    sellerFiscalProfile: {
      rfc: 'XAXX010101000',
      razonSocial: 'Vendedor Snapshot',
      regimenFiscal: '601',
      codigoPostal: '83000',
      usoCFDI: 'G03',
      emailFacturacion: 'seller-snapshot@mg.test',
    },
    amount: 9000,
    currency: 'MXN',
  });
  const draft = await InvoiceDraft.create({
    transactionId: transaction._id,
    fiscalSnapshotId: snapshot._id,
    auctionResultId: result._id,
    buyerId: buyer._id,
    sellerId: seller._id,
    amount: 9000,
    currency: 'MXN',
    status: 'ready',
    createdFromTransaction: true,
  });
  const queue = await InvoiceQueue.create({
    transactionId: transaction._id,
    invoiceDraftId: draft._id,
    fiscalSnapshotId: snapshot._id,
    status: 'completed',
    queuedAt: new Date(),
    processedAt: new Date(),
  });
  const record = await InvoiceRecord.create({
    transactionId: transaction._id,
    invoiceDraftId: draft._id,
    invoiceQueueId: queue._id,
    status: 'completed',
    attempts: 1,
    processedAt: new Date(),
  });

  return { seller, buyer, transaction, snapshot, draft, queue, record };
}

describe('CFDI domain preparation', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('validates a minimal valid CFDI request', () => {
    const result = validateCfdiRequest(validCfdiRequest());

    expect(result).toEqual({ valid: true, issues: [] });
  });

  it('rejects invalid RFC values', () => {
    const result = validateCfdiRequest(validCfdiRequest({
      issuer: { ...validCfdiRequest().issuer, rfc: 'BAD' },
    }));

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('issuer_rfc_invalid');
  });

  it('rejects invalid postal codes', () => {
    const result = validateCfdiRequest(validCfdiRequest({
      receiver: { ...validCfdiRequest().receiver, postalCode: '1234' },
    }));

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('receiver_postal_code_invalid');
  });

  it('rejects empty concepts', () => {
    const result = validateCfdiRequest(validCfdiRequest({ concepts: [] }));

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('concepts_missing');
  });

  it('rejects invalid totals', () => {
    const result = validateCfdiRequest(validCfdiRequest({
      totals: { subtotal: 0, taxes: 0, total: 0, currency: 'MXN' },
    }));

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('total_invalid');
  });

  it('rejects invalid issuer regimen', () => {
    const request = validCfdiRequest({
      issuer: { ...validCfdiRequest().issuer, regimenFiscal: '999' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_issuer_regimen');
  });

  it('rejects invalid receiver regimen', () => {
    const request = validCfdiRequest({
      receiver: { ...validCfdiRequest().receiver, regimenFiscal: '999' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_receiver_regimen');
  });

  it('rejects invalid usoCFDI', () => {
    const request = validCfdiRequest({
      receiver: { ...validCfdiRequest().receiver, usoCFDI: 'BAD' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_uso_cfdi');
  });

  it('rejects invalid currency', () => {
    const request = validCfdiRequest({
      currency: 'USD' as any,
      totals: { subtotal: 9000, taxes: 0, total: 9000, currency: 'USD' as any },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_currency');
  });

  it('rejects invalid taxObject', () => {
    const request = validCfdiRequest({
      concepts: [{ ...validCfdiRequest().concepts[0], taxObject: '99' }],
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_tax_object');
  });

  it('rejects missing productServiceKey', () => {
    const request = validCfdiRequest({
      concepts: [{ ...validCfdiRequest().concepts[0], productServiceKey: '' }],
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('missing_product_service_key');
  });

  it('rejects missing unitKey', () => {
    const request = validCfdiRequest({
      concepts: [{ ...validCfdiRequest().concepts[0], unitKey: '' }],
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('missing_unit_key');
  });

  it('rejects invalid concept amount', () => {
    const request = validCfdiRequest({
      concepts: [{ ...validCfdiRequest().concepts[0], amount: 8000 }],
      totals: { subtotal: 8000, taxes: 0, total: 8000, currency: 'MXN' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_concept_amount');
  });

  it('rejects invalid subtotal', () => {
    const request = validCfdiRequest({
      totals: { subtotal: 8000, taxes: 0, total: 9000, currency: 'MXN' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_subtotal');
  });

  it('rejects total lower than subtotal', () => {
    const request = validCfdiRequest({
      totals: { subtotal: 9000, taxes: 0, total: 8000, currency: 'MXN' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_total');
  });

  it('rejects negative taxes', () => {
    const request = validCfdiRequest({
      totals: { subtotal: 9000, taxes: -1, total: 9000, currency: 'MXN' },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('invalid_taxes');
  });

  it('rejects same issuer and receiver RFC', () => {
    const request = validCfdiRequest({
      receiver: { ...validCfdiRequest().receiver, rfc: validCfdiRequest().issuer.rfc },
    });

    const result = validateCfdiRequest(request);

    expect(result.valid).toBe(false);
    expect(result.issues).toContain('same_issuer_receiver_rfc');
  });

  it('maps issuer into provider invoice request', () => {
    const cfdiRequest = validCfdiRequest();
    const providerRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);

    expect(providerRequest.issuer).toEqual({
      rfc: cfdiRequest.issuer.rfc,
      name: cfdiRequest.issuer.name,
      fiscalRegime: cfdiRequest.issuer.regimenFiscal,
      postalCode: cfdiRequest.issuer.postalCode,
    });
  });

  it('maps receiver into provider invoice request', () => {
    const cfdiRequest = validCfdiRequest();
    const providerRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);

    expect(providerRequest.receiver).toEqual({
      rfc: cfdiRequest.receiver.rfc,
      name: cfdiRequest.receiver.name,
      fiscalRegime: cfdiRequest.receiver.regimenFiscal,
      postalCode: cfdiRequest.receiver.postalCode,
      invoiceUse: cfdiRequest.receiver.usoCFDI,
    });
  });

  it('maps concepts into provider invoice request', () => {
    const cfdiRequest = validCfdiRequest();
    const providerRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);

    expect(providerRequest.concepts).toEqual(cfdiRequest.concepts);
  });

  it('maps totals into provider invoice request', () => {
    const cfdiRequest = validCfdiRequest();
    const providerRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);

    expect(providerRequest.totals).toEqual({
      subtotal: cfdiRequest.totals.subtotal,
      taxes: cfdiRequest.totals.taxes,
      total: cfdiRequest.totals.total,
      currency: cfdiRequest.totals.currency,
    });
  });

  it('preserves transactionId and invoiceRecordId in provider invoice request', () => {
    const cfdiRequest = validCfdiRequest();
    const providerRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);

    expect(providerRequest.transactionId).toBe(cfdiRequest.transactionId);
    expect(providerRequest.invoiceRecordId).toBe(cfdiRequest.invoiceRecordId);
    expect(providerRequest.metadata).toMatchObject({
      source: 'internal_cfdi_request',
      transactionId: cfdiRequest.transactionId,
      invoiceRecordId: cfdiRequest.invoiceRecordId,
    });
  });

  it('builds the CFDI request from FiscalSnapshot, not live FiscalProfile', async () => {
    const { seller, buyer, transaction, snapshot, draft, record } = await createInvoiceRecordFixture();
    await FiscalProfile.create({
      userId: seller._id,
      rfc: 'COSC8001137NA',
      razonSocial: 'Vendedor Vivo',
      regimenFiscal: '626',
      codigoPostal: '84000',
      usoCFDI: 'G01',
      emailFacturacion: 'seller-live@mg.test',
    });
    await FiscalProfile.create({
      userId: buyer._id,
      rfc: 'GODE561231GR8',
      razonSocial: 'Comprador Vivo',
      regimenFiscal: '605',
      codigoPostal: '85000',
      usoCFDI: 'D01',
      emailFacturacion: 'buyer-live@mg.test',
    });

    const cfdiRequest = buildCfdiRequest({
      transaction,
      fiscalSnapshot: snapshot,
      invoiceDraft: draft,
      invoiceRecord: record,
    });

    expect(cfdiRequest.issuer.name).toBe('Vendedor Snapshot');
    expect(cfdiRequest.receiver.name).toBe('Comprador Snapshot');
    expect(cfdiRequest.issuer.postalCode).toBe('83000');
    expect(cfdiRequest.receiver.usoCFDI).toBe('G03');
    expect(cfdiRequest.concepts[0].productServiceKey).toBe('10101500');
    expect(cfdiRequest.concepts[0].unitKey).toBe('E48');
  });

  it('returns 401 without auth on CFDI preview', async () => {
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app).get(`/admin/fiscal/invoice-records/${record._id}/cfdi-preview`);

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user on CFDI preview', async () => {
    const token = await authToken('user');
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/cfdi-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
  });

  it('returns CFDI preview for admin without calling provider', async () => {
    const token = await authToken('admin');
    const { record } = await createInvoiceRecordFixture();
    const resolveSpy = vi.spyOn(providerRegistry, 'resolveFiscalProvider');

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/cfdi-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ valid: true, issues: [] });
    expect(res.body.cfdiRequest.issuer.name).toBe('Vendedor Snapshot');
    expect(res.body.cfdiRequest.receiver.name).toBe('Comprador Snapshot');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('does not modify InvoiceRecord on CFDI preview', async () => {
    const token = await authToken('super');
    const { record } = await createInvoiceRecordFixture();
    const before = await InvoiceRecord.findById(record._id).lean();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/cfdi-preview`)
      .set('Authorization', bearer(token));
    const after = await InvoiceRecord.findById(record._id).lean();

    expect(res.status).toBe(200);
    expect(after).toEqual(before);
  });

  it('does not expose XML, PDF or fiscal UUID fields in CFDI preview', async () => {
    const token = await authToken('admin');
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/cfdi-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.cfdiRequest).not.toHaveProperty('xml');
    expect(res.body.cfdiRequest).not.toHaveProperty('pdf');
    expect(res.body.cfdiRequest).not.toHaveProperty('uuid');
    expect(res.body.cfdiRequest).not.toHaveProperty('timbreFiscal');
  });

  it('returns 401 without auth on provider preview', async () => {
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app).get(`/admin/fiscal/invoice-records/${record._id}/provider-preview`);

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user on provider preview', async () => {
    const token = await authToken('user');
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/provider-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
  });

  it('returns provider preview for admin without calling provider', async () => {
    const token = await authToken('admin');
    const { record } = await createInvoiceRecordFixture();
    const resolveSpy = vi.spyOn(providerRegistry, 'resolveFiscalProvider');

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/provider-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.validation).toEqual({ valid: true, issues: [] });
    expect(res.body.providerInvoiceRequest.issuer.name).toBe('Vendedor Snapshot');
    expect(res.body.providerInvoiceRequest.receiver.name).toBe('Comprador Snapshot');
    expect(res.body.providerInvoiceRequest.metadata.source).toBe('internal_cfdi_request');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('does not modify InvoiceRecord on provider preview', async () => {
    const token = await authToken('super');
    const { record } = await createInvoiceRecordFixture();
    const before = await InvoiceRecord.findById(record._id).lean();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/provider-preview`)
      .set('Authorization', bearer(token));
    const after = await InvoiceRecord.findById(record._id).lean();

    expect(res.status).toBe(200);
    expect(after).toEqual(before);
  });

  it('does not expose XML, PDF or fiscal UUID fields in provider preview', async () => {
    const token = await authToken('admin');
    const { record } = await createInvoiceRecordFixture();

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/provider-preview`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.providerInvoiceRequest).not.toHaveProperty('xml');
    expect(res.body.providerInvoiceRequest).not.toHaveProperty('pdf');
    expect(res.body.providerInvoiceRequest).not.toHaveProperty('uuid');
    expect(res.body.providerInvoiceRequest).not.toHaveProperty('timbreFiscal');
  });

  it('keeps MockFiscalProvider compatible with provider invoice request input', async () => {
    const cfdiRequest = validCfdiRequest();
    const providerInvoiceRequest = mapCfdiToProviderInvoiceRequest(cfdiRequest);
    const provider = new MockFiscalProvider();

    const validation = await provider.validateInvoiceInput({
      transactionId: cfdiRequest.transactionId,
      invoiceDraftId: new Types.ObjectId(),
      invoiceQueueId: new Types.ObjectId(),
      cfdiRequest,
      providerInvoiceRequest,
    });

    expect(validation).toEqual({ ok: true, message: 'Mock validation successful' });
  });

  it('keeps InvoiceProcessor working with the provider abstraction', async () => {
    const { queue } = await createInvoiceRecordFixture();
    await InvoiceQueue.findByIdAndUpdate(queue._id, { $set: { status: 'queued' } }, { runValidators: true });

    const result = await processInvoiceQueue({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(true);
    expect(result.invoiceQueue?.status).toBe('completed');
    expect(result.invoiceRecord?.status).toBe('completed');
  });
});
