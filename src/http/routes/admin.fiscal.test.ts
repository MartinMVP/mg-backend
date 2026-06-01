import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
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
