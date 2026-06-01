import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalProfile } from '../../domain/fiscalProfiles/fiscalProfile.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { Notification } from '../../domain/notifications/notification.model';
import { Transaction } from '../../domain/transactions/transaction.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('sales confirmation routes', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function createSaleResult(sellerId: any, buyerId: any, status = 'pending_contact') {
    const listing = await createTestListing(sellerId);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentPrice: 2000,
      currentWinner: buyerId,
      endsAt: new Date(Date.now() - 60_000),
    });

    return AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId,
      buyerId,
      finalPrice: 2000,
      closedAt: new Date(),
      status,
    });
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

  it('allows the seller to confirm a sale', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sale_confirmed');
    expect(freshSale?.status).toBe('sale_confirmed');
  });

  it('creates a transaction when a sale is confirmed', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });

    expect(res.status).toBe(200);
    expect(transaction).toBeTruthy();
    expect(String(transaction?.buyerId)).toBe(String(buyer._id));
    expect(String(transaction?.sellerId)).toBe(String(seller._id));
    expect(transaction?.amount).toBe(2000);
    expect(transaction?.status).toBe('pending');
  });

  it('creates a fiscal snapshot when buyer and seller fiscal profiles exist', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await createFiscalProfile(seller._id);
    await createFiscalProfile(buyer._id);

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });
    const snapshot = await FiscalSnapshot.findOne({ transactionId: transaction?._id });

    expect(res.status).toBe(200);
    expect(transaction?.status).toBe('ready_for_invoice');
    expect(snapshot).toBeTruthy();
    expect(snapshot?.amount).toBe(2000);
    expect(snapshot?.currency).toBe('MXN');
    expect((snapshot?.buyerFiscalProfile as any)?.rfc).toBe('XAXX010101000');
    expect((snapshot?.sellerFiscalProfile as any)?.rfc).toBe('XAXX010101000');
  });

  it('creates an invoice draft when transaction is ready_for_invoice', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await createFiscalProfile(seller._id);
    await createFiscalProfile(buyer._id);

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });
    const snapshot = await FiscalSnapshot.findOne({ transactionId: transaction?._id });
    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction?._id });

    expect(res.status).toBe(200);
    expect(transaction?.status).toBe('ready_for_invoice');
    expect(invoiceDraft).toBeTruthy();
    expect(String(invoiceDraft?.fiscalSnapshotId)).toBe(String(snapshot?._id));
    expect(invoiceDraft?.status).toBe('ready');
    expect(invoiceDraft?.createdFromTransaction).toBe(true);
  });

  it('creates a pending transaction when a fiscal profile is missing', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await createFiscalProfile(seller._id);

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });
    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction?._id });

    expect(res.status).toBe(200);
    expect(transaction?.status).toBe('pending');
    expect(invoiceDraft).toBeNull();
  });

  it('does not duplicate transaction, fiscal snapshot, or invoice draft when confirm is called twice', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await createFiscalProfile(seller._id);
    await createFiscalProfile(buyer._id);

    const first = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transactionCount = await Transaction.countDocuments({ auctionResultId: sale._id });
    const transaction = await Transaction.findOne({ auctionResultId: sale._id });
    const snapshotCount = await FiscalSnapshot.countDocuments({ transactionId: transaction?._id });
    const invoiceDraftCount = await InvoiceDraft.countDocuments({ transactionId: transaction?._id });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(transactionCount).toBe(1);
    expect(snapshotCount).toBe(1);
    expect(invoiceDraftCount).toBe(1);
  });

  it('keeps transaction and fiscal snapshot intact when invoice draft is created', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await createFiscalProfile(seller._id);
    await createFiscalProfile(buyer._id);

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });
    const snapshot = await FiscalSnapshot.findOne({ transactionId: transaction?._id });
    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction?._id });

    expect(res.status).toBe(200);
    expect(transaction).toMatchObject({
      amount: 2000,
      status: 'ready_for_invoice',
    });
    expect(snapshot).toMatchObject({
      amount: 2000,
      currency: 'MXN',
    });
    expect(invoiceDraft?.status).toBe('ready');
  });

  it('allows the seller to cancel a sale and notifies the buyer', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/cancel`)
      .set('Authorization', bearer(token));

    const notification = await Notification.findOne({
      userId: buyer._id,
      type: 'sale_cancelled',
    });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sale_cancelled');
    expect(notification).toBeTruthy();
  });

  it('marks an existing transaction as cancelled when a sale is cancelled', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    await Transaction.create({
      auctionResultId: sale._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 2000,
      status: 'pending',
    });

    const res = await request(app)
      .post(`/sales/${sale._id}/cancel`)
      .set('Authorization', bearer(token));

    const transaction = await Transaction.findOne({ auctionResultId: sale._id });

    expect(res.status).toBe(200);
    expect(transaction?.status).toBe('cancelled');
  });

  it('marks an existing invoice draft as cancelled when a sale is cancelled', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const transaction = await Transaction.create({
      auctionResultId: sale._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 2000,
      status: 'ready_for_invoice',
    });
    const snapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: sale._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 2000,
    });
    await InvoiceDraft.create({
      transactionId: transaction._id,
      fiscalSnapshotId: snapshot._id,
      auctionResultId: sale._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 2000,
      status: 'ready',
      createdFromTransaction: true,
    });

    const res = await request(app)
      .post(`/sales/${sale._id}/cancel`)
      .set('Authorization', bearer(token));

    const invoiceDraft = await InvoiceDraft.findOne({ transactionId: transaction._id });
    const freshTransaction = await Transaction.findById(transaction._id);
    const freshSnapshot = await FiscalSnapshot.findById(snapshot._id);

    expect(res.status).toBe(200);
    expect(invoiceDraft?.status).toBe('cancelled');
    expect(freshTransaction?.status).toBe('cancelled');
    expect(freshSnapshot).toBeTruthy();
  });

  it.each(['confirm', 'cancel'])('rejects buyer attempts to %s a sale', async (action) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(buyer._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(403);
    expect(freshSale?.status).toBe('pending_contact');
  });

  it.each(['confirm', 'cancel'])('rejects another user attempts to %s a sale', async (action) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const other = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(other._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(403);
    expect(freshSale?.status).toBe('pending_contact');
  });

  it('does not allow confirming a sale twice', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const first = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ error: 'Sale already finalized' });
  });

  it('notifies the buyer when a sale is confirmed', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const notification = await Notification.findOne({
      userId: buyer._id,
      type: 'sale_confirmed',
    });

    expect(res.status).toBe(200);
    expect(notification).toBeTruthy();
    expect(notification?.read).toBe(false);
  });

  it.each(['confirm', 'cancel'])('returns 400 for invalid ObjectId on %s', async (action) => {
    const seller = await createTestUser('user');
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/not-an-object-id/${action}`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid sale id' });
  });

  it('does not allow confirming a sale that was cancelled', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id, 'sale_cancelled');
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/confirm`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Sale already finalized' });
    expect(freshSale?.status).toBe('sale_cancelled');
  });

  it('does not allow cancelling a sale that was confirmed', async () => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id, 'sale_confirmed');
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/cancel`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Sale already finalized' });
    expect(freshSale?.status).toBe('sale_confirmed');
  });

  it.each(['confirm', 'cancel'])('does not allow %s when sale is in dispute', async (action) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const sale = await createSaleResult(seller._id, buyer._id, 'in_dispute');
    const token = createAccessToken(String(seller._id), 'user');

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Sale already finalized' });
    expect(freshSale?.status).toBe('in_dispute');
  });

  it.each([
    ['admin', 'confirm', 'sale_confirmed'],
    ['admin', 'cancel', 'sale_cancelled'],
    ['super', 'confirm', 'sale_confirmed'],
    ['super', 'cancel', 'sale_cancelled'],
  ] as const)('allows role %s to %s a sale', async (role, action, status) => {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const manager = await createTestUser(role);
    const sale = await createSaleResult(seller._id, buyer._id);
    const token = createAccessToken(String(manager._id), role);

    const res = await request(app)
      .post(`/sales/${sale._id}/${action}`)
      .set('Authorization', bearer(token));

    const freshSale = await AuctionResult.findById(sale._id);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe(status);
    expect(freshSale?.status).toBe(status);
  });
});
