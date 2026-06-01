import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { InvoiceQueue } from '../../domain/invoiceQueue/invoiceQueue.model';
import { Transaction, TransactionStatus } from '../../domain/transactions/transaction.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('GET /admin/fiscal/transactions', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createFiscalTransaction(status: TransactionStatus = 'ready_for_invoice') {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 3000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 3000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 3000,
      status,
    });
    const fiscalSnapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      buyerFiscalProfile: { rfc: 'BUYERTEST123' },
      sellerFiscalProfile: { rfc: 'SELLERTEST12' },
      amount: 3000,
      currency: 'MXN',
    });
    const invoiceDraft = await InvoiceDraft.create({
      transactionId: transaction._id,
      fiscalSnapshotId: fiscalSnapshot._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 3000,
      currency: 'MXN',
      status: 'ready',
      createdFromTransaction: true,
    });

    return { buyer, seller, result, transaction, fiscalSnapshot, invoiceDraft };
  }

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/admin/fiscal/transactions');

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user', async () => {
    const user = await createTestUser('user');
    const token = createAccessToken(String(user._id), 'user');

    const res = await request(app)
      .get('/admin/fiscal/transactions')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('allows admin to list fiscal transactions', async () => {
    const admin = await createTestUser('admin');
    const token = createAccessToken(String(admin._id), 'admin');
    await createFiscalTransaction();

    const res = await request(app)
      .get('/admin/fiscal/transactions')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].transaction).toMatchObject({
      amount: 3000,
      status: 'ready_for_invoice',
    });
    expect(res.body.items[0].fiscalSnapshot).toBeTruthy();
    expect(res.body.items[0].invoiceDraft).toMatchObject({ status: 'ready' });
  });

  it('allows super to list fiscal transactions', async () => {
    const superUser = await createTestUser('super');
    const token = createAccessToken(String(superUser._id), 'super');
    await createFiscalTransaction();

    const res = await request(app)
      .get('/admin/fiscal/transactions')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });

  it('filters by transaction status', async () => {
    const admin = await createTestUser('admin');
    const token = createAccessToken(String(admin._id), 'admin');
    const ready = await createFiscalTransaction('ready_for_invoice');
    await createFiscalTransaction('pending');

    const res = await request(app)
      .get('/admin/fiscal/transactions?status=ready_for_invoice')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].transaction._id).toBe(String(ready.transaction._id));
    expect(res.body.items[0].transaction.status).toBe('ready_for_invoice');
  });
});

describe('GET /admin/fiscal/transactions/:id', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function authAsAdmin() {
    const admin = await createTestUser('admin');
    return createAccessToken(String(admin._id), 'admin');
  }

  async function createFiscalTransactionDetail() {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 4500,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 4500,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 4500,
      status: 'ready_for_invoice',
    });
    const fiscalSnapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      buyerFiscalProfile: { rfc: 'BUYERTEST123' },
      sellerFiscalProfile: { rfc: 'SELLERTEST12' },
      amount: 4500,
      currency: 'MXN',
    });
    await InvoiceDraft.create({
      transactionId: transaction._id,
      fiscalSnapshotId: fiscalSnapshot._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 4500,
      currency: 'MXN',
      status: 'ready',
      createdFromTransaction: true,
    });

    return transaction;
  }

  it('returns transaction, snapshot, and invoice draft details', async () => {
    const token = await authAsAdmin();
    const transaction = await createFiscalTransactionDetail();

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.transaction._id).toBe(String(transaction._id));
    expect(res.body.fiscalSnapshot).toMatchObject({ amount: 4500, currency: 'MXN' });
    expect(res.body.invoiceDraft).toMatchObject({ amount: 4500, status: 'ready' });
    expect(res.body.auctionResult).toMatchObject({ finalPrice: 4500, status: 'sale_confirmed' });
  });

  it('returns 400 for invalid id', async () => {
    const token = await authAsAdmin();

    const res = await request(app)
      .get('/admin/fiscal/transactions/not-an-object-id')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid transaction id' });
  });

  it('returns 404 when transaction does not exist', async () => {
    const token = await authAsAdmin();

    const res = await request(app)
      .get('/admin/fiscal/transactions/6a1d07b443a21ef2e6813959')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });
});

describe('GET /admin/fiscal/transactions/:id/readiness', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createFiscalTransactionForReadiness(options: {
    transactionStatus?: TransactionStatus;
    invoiceDraftStatus?: 'draft' | 'ready' | 'blocked' | 'cancelled';
    withSnapshot?: boolean;
    withInvoiceDraft?: boolean;
    buyerFiscalProfile?: Record<string, unknown> | null;
    sellerFiscalProfile?: Record<string, unknown> | null;
  } = {}) {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 5000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 5000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 5000,
      status: options.transactionStatus || 'ready_for_invoice',
    });
    const defaultProfile = {
      rfc: 'MGRFCREADY12',
      razonSocial: 'Mercado Ganadero Test',
      regimenFiscal: '601',
      codigoPostal: '83000',
      usoCFDI: 'G03',
      emailFacturacion: 'facturacion@mg.test',
    };
    let fiscalSnapshot: any = null;

    if (options.withSnapshot !== false) {
      fiscalSnapshot = await FiscalSnapshot.create({
        transactionId: transaction._id,
        auctionResultId: result._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        buyerFiscalProfile: options.buyerFiscalProfile === undefined ? defaultProfile : options.buyerFiscalProfile,
        sellerFiscalProfile: options.sellerFiscalProfile === undefined ? defaultProfile : options.sellerFiscalProfile,
        amount: 5000,
        currency: 'MXN',
      });
    }

    if (options.withInvoiceDraft !== false && fiscalSnapshot) {
      await InvoiceDraft.create({
        transactionId: transaction._id,
        fiscalSnapshotId: fiscalSnapshot._id,
        auctionResultId: result._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        amount: 5000,
        currency: 'MXN',
        status: options.invoiceDraftStatus || 'ready',
        createdFromTransaction: true,
      });
    }

    return transaction;
  }

  async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
    const user = await createTestUser(role);
    return createAccessToken(String(user._id), role);
  }

  it('returns 401 without auth', async () => {
    const transaction = await createFiscalTransactionForReadiness();

    const res = await request(app).get(`/admin/fiscal/transactions/${transaction._id}/readiness`);

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user', async () => {
    const token = await authToken('user');
    const transaction = await createFiscalTransactionForReadiness();

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('allows admin to evaluate readiness', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness();

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.transactionId).toBe(String(transaction._id));
  });

  it('returns 404 when transaction does not exist', async () => {
    const token = await authToken('admin');

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${new Types.ObjectId()}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
  });

  it('returns blocked when transaction is cancelled', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness({ transactionStatus: 'cancelled' });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('blocked');
    expect(res.body.readiness.issues).toContain('transaction_cancelled');
  });

  it('returns blocked when fiscal snapshot is missing', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness({
      withSnapshot: false,
      withInvoiceDraft: false,
    });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('blocked');
    expect(res.body.readiness.issues).toContain('fiscal_snapshot_missing');
  });

  it('returns blocked when invoice draft is missing', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness({ withInvoiceDraft: false });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('blocked');
    expect(res.body.readiness.issues).toContain('invoice_draft_missing');
  });

  it('returns ready when profiles are complete', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness();

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness).toEqual({ status: 'ready', issues: [] });
  });

  it('returns warning when billing email is missing', async () => {
    const token = await authToken('admin');
    const profileWithoutEmail = {
      rfc: 'MGRFCREADY12',
      razonSocial: 'Mercado Ganadero Test',
      regimenFiscal: '601',
      codigoPostal: '83000',
      usoCFDI: 'G03',
    };
    const transaction = await createFiscalTransactionForReadiness({
      buyerFiscalProfile: profileWithoutEmail,
    });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('warning');
    expect(res.body.readiness.issues).toContain('buyer_email_facturacion_missing');
  });

  it('returns blocked when RFC is invalid in snapshot', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness({
      buyerFiscalProfile: {
        rfc: 'BAD',
        razonSocial: 'Mercado Ganadero Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
        emailFacturacion: 'facturacion@mg.test',
      },
    });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('blocked');
    expect(res.body.readiness.issues).toContain('buyer_rfc_invalid');
  });

  it('returns blocked when postal code is invalid in snapshot', async () => {
    const token = await authToken('admin');
    const transaction = await createFiscalTransactionForReadiness({
      sellerFiscalProfile: {
        rfc: 'MGRFCREADY12',
        razonSocial: 'Mercado Ganadero Test',
        regimenFiscal: '601',
        codigoPostal: 'ABC',
        usoCFDI: 'G03',
        emailFacturacion: 'facturacion@mg.test',
      },
    });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/readiness`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.readiness.status).toBe('blocked');
    expect(res.body.readiness.issues).toContain('seller_codigo_postal_invalid');
  });
});

describe('POST /admin/fiscal/transactions/:id/queue', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  const completeProfile = {
    rfc: 'MGRFCREADY12',
    razonSocial: 'Mercado Ganadero Test',
    regimenFiscal: '601',
    codigoPostal: '83000',
    usoCFDI: 'G03',
    emailFacturacion: 'facturacion@mg.test',
  };

  async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
    const user = await createTestUser(role);
    return createAccessToken(String(user._id), role);
  }

  async function createQueueCandidate(options: {
    transactionStatus?: TransactionStatus;
    invoiceDraftStatus?: 'draft' | 'ready' | 'blocked' | 'cancelled';
    buyerFiscalProfile?: Record<string, unknown> | null;
    sellerFiscalProfile?: Record<string, unknown> | null;
    withSnapshot?: boolean;
    withInvoiceDraft?: boolean;
  } = {}) {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 6000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 6000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 6000,
      status: options.transactionStatus || 'ready_for_invoice',
    });
    let fiscalSnapshot: any = null;

    if (options.withSnapshot !== false) {
      fiscalSnapshot = await FiscalSnapshot.create({
        transactionId: transaction._id,
        auctionResultId: result._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        buyerFiscalProfile: options.buyerFiscalProfile === undefined ? completeProfile : options.buyerFiscalProfile,
        sellerFiscalProfile: options.sellerFiscalProfile === undefined ? completeProfile : options.sellerFiscalProfile,
        amount: 6000,
        currency: 'MXN',
      });
    }

    if (options.withInvoiceDraft !== false && fiscalSnapshot) {
      await InvoiceDraft.create({
        transactionId: transaction._id,
        fiscalSnapshotId: fiscalSnapshot._id,
        auctionResultId: result._id,
        buyerId: buyer._id,
        sellerId: seller._id,
        amount: 6000,
        currency: 'MXN',
        status: options.invoiceDraftStatus || 'ready',
        createdFromTransaction: true,
      });
    }

    return transaction;
  }

  it('returns 401 without auth', async () => {
    const transaction = await createQueueCandidate();

    const res = await request(app).post(`/admin/fiscal/transactions/${transaction._id}/queue`);

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user', async () => {
    const token = await authToken('user');
    const transaction = await createQueueCandidate();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 409 when readiness is blocked', async () => {
    const token = await authToken('admin');
    const transaction = await createQueueCandidate({ withInvoiceDraft: false });

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body.readiness.status).toBe('blocked');
    expect(await InvoiceQueue.countDocuments()).toBe(0);
  });

  it('returns 409 when readiness is warning', async () => {
    const token = await authToken('admin');
    const transaction = await createQueueCandidate({
      buyerFiscalProfile: {
        rfc: 'MGRFCREADY12',
        razonSocial: 'Mercado Ganadero Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
      },
    });

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body.readiness.status).toBe('warning');
    expect(await InvoiceQueue.countDocuments()).toBe(0);
  });

  it('allows admin to create a queued invoice operation when readiness is ready', async () => {
    const token = await authToken('admin');
    const transaction = await createQueueCandidate();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      transactionId: String(transaction._id),
      status: 'queued',
    });
    expect(res.body.invoiceDraftId).toBeTruthy();
    expect(res.body.fiscalSnapshotId).toBeTruthy();
    expect(await InvoiceQueue.countDocuments({ transactionId: transaction._id })).toBe(1);
  });

  it('does not duplicate an active queue', async () => {
    const token = await authToken('admin');
    const transaction = await createQueueCandidate();

    const first = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body._id).toBe(first.body._id);
    expect(await InvoiceQueue.countDocuments({ transactionId: transaction._id })).toBe(1);
  });

  it('allows super to create a queued invoice operation', async () => {
    const token = await authToken('super');
    const transaction = await createQueueCandidate();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('queued');
  });

  it('is safe when queue requests run concurrently', async () => {
    const token = await authToken('admin');
    const transaction = await createQueueCandidate();

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post(`/admin/fiscal/transactions/${transaction._id}/queue`)
          .set('Authorization', bearer(token))
      )
    );

    expect(responses.every((res) => res.status === 200)).toBe(true);
    expect(new Set(responses.map((res) => res.body._id)).size).toBe(1);
    expect(await InvoiceQueue.countDocuments({ transactionId: transaction._id })).toBe(1);
  });
});

describe('POST /admin/fiscal/transactions/:id/recover', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
    const user = await createTestUser(role);
    return createAccessToken(String(user._id), role);
  }

  const completeSnapshotProfile = {
    rfc: 'XAXX010101000',
    razonSocial: 'Rancho Fiscal SA de CV',
    regimenFiscal: '601',
    codigoPostal: '83000',
    usoCFDI: 'G03',
    emailFacturacion: 'facturas@rancho.test',
  };

  async function createPendingRecoveryCandidate(options: {
    buyerFiscalProfile?: Record<string, unknown> | null;
    sellerFiscalProfile?: Record<string, unknown> | null;
  } = {}) {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 7000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 7000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 7000,
      status: 'pending',
    });
    const fiscalSnapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      buyerFiscalProfile: options.buyerFiscalProfile ?? null,
      sellerFiscalProfile: options.sellerFiscalProfile ?? null,
      amount: 7000,
      currency: 'MXN',
    });

    return { buyer, seller, transaction, fiscalSnapshot };
  }

  async function createFiscalProfile(userId: any) {
    return FiscalProfile.create({
      userId,
      rfc: 'XAXX010101000',
      razonSocial: 'Rancho Fiscal SA de CV',
      regimenFiscal: '601',
      codigoPostal: '83000',
      usoCFDI: 'G03',
      emailFacturacion: 'facturas@rancho.test',
    });
  }

  it('returns 403 for role user', async () => {
    const token = await authToken('user');
    const { transaction } = await createPendingRecoveryCandidate();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('keeps transaction pending when snapshot profiles are still missing', async () => {
    const token = await authToken('admin');
    const { transaction } = await createPendingRecoveryCandidate();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const freshTransaction = await Transaction.findById(transaction._id);
    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction._id });

    expect(res.status).toBe(409);
    expect(res.body.recovery.recovered).toBe(false);
    expect(res.body.recovery.issues).toEqual([
      'fiscal_snapshot_buyer_profile_missing',
      'fiscal_snapshot_seller_profile_missing',
    ]);
    expect(freshTransaction?.status).toBe('pending');
    expect(invoiceDraft).toBeNull();
  });

  it('does not recover when current profiles are complete but snapshot is incomplete', async () => {
    const token = await authToken('admin');
    const { buyer, seller, transaction } = await createPendingRecoveryCandidate();
    await createFiscalProfile(buyer._id);
    await createFiscalProfile(seller._id);

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const freshTransaction = await Transaction.findById(transaction._id);
    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction._id });

    expect(res.status).toBe(409);
    expect(res.body.recovery.recovered).toBe(false);
    expect(res.body.recovery.issues).toEqual([
      'fiscal_snapshot_buyer_profile_missing',
      'fiscal_snapshot_seller_profile_missing',
    ]);
    expect(freshTransaction?.status).toBe('pending');
    expect(invoiceDraft).toBeNull();
  });

  it('promotes a pending transaction to ready_for_invoice when snapshot profiles are complete', async () => {
    const token = await authToken('admin');
    const { transaction } = await createPendingRecoveryCandidate({
      buyerFiscalProfile: completeSnapshotProfile,
      sellerFiscalProfile: completeSnapshotProfile,
    });

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const freshTransaction = await Transaction.findById(transaction._id);

    expect(res.status).toBe(200);
    expect(res.body.recovery.recovered).toBe(true);
    expect(freshTransaction?.status).toBe('ready_for_invoice');
  });

  it('creates an invoice draft during recovery', async () => {
    const token = await authToken('admin');
    const { transaction, fiscalSnapshot } = await createPendingRecoveryCandidate({
      buyerFiscalProfile: completeSnapshotProfile,
      sellerFiscalProfile: completeSnapshotProfile,
    });

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction._id });

    expect(res.status).toBe(200);
    expect(invoiceDraft).toBeTruthy();
    expect(invoiceDraft?.status).toBe('ready');
    expect(String(invoiceDraft?.fiscalSnapshotId)).toBe(String(fiscalSnapshot._id));
  });

  it('does not create an invoice draft when snapshot is incomplete', async () => {
    const token = await authToken('admin');
    const { buyer, seller, transaction } = await createPendingRecoveryCandidate();
    await createFiscalProfile(buyer._id);
    await createFiscalProfile(seller._id);

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction._id });

    expect(res.status).toBe(409);
    expect(invoiceDraft).toBeNull();
  });

  it('does not modify the existing fiscal snapshot', async () => {
    const token = await authToken('admin');
    const { transaction, fiscalSnapshot } = await createPendingRecoveryCandidate({
      buyerFiscalProfile: completeSnapshotProfile,
      sellerFiscalProfile: completeSnapshotProfile,
    });
    const before = await FiscalSnapshot.findById(fiscalSnapshot._id).lean();

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    const after = await FiscalSnapshot.findById(fiscalSnapshot._id).lean();

    expect(res.status).toBe(200);
    expect(after?.buyerFiscalProfile).toEqual(before?.buyerFiscalProfile);
    expect(after?.sellerFiscalProfile).toEqual(before?.sellerFiscalProfile);
    expect(after?.amount).toBe(before?.amount);
  });

  it('allows admin to recover a fiscal transaction', async () => {
    const token = await authToken('admin');
    const { transaction } = await createPendingRecoveryCandidate({
      buyerFiscalProfile: completeSnapshotProfile,
      sellerFiscalProfile: completeSnapshotProfile,
    });

    const res = await request(app)
      .post(`/admin/fiscal/transactions/${transaction._id}/recover`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.transactionId).toBe(String(transaction._id));
  });
});
