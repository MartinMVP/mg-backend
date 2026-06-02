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
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
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
        quantity: 1,
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
});
