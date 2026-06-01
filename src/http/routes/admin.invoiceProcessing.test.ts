import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { InvoiceQueue } from '../../domain/invoiceQueue/invoiceQueue.model';
import { InvoiceRecord } from '../../domain/invoiceRecords/invoiceRecord.model';
import { Transaction } from '../../domain/transactions/transaction.model';
import { bearer, createAccessToken } from '../../test/helpers/auth';
import { createLiveAuction, createTestListing, createTestUser } from '../../test/helpers/factories';

describe('admin fiscal invoice processing', () => {
  let app: typeof import('../../app').default;

  beforeAll(async () => {
    app = (await import('../../app')).default;
  });

  async function authToken(role: 'user' | 'admin' | 'super' = 'admin') {
    const user = await createTestUser(role);
    return createAccessToken(String(user._id), role);
  }

  async function createQueuedInvoice(status: 'queued' | 'processing' | 'completed' | 'cancelled' = 'queued') {
    const seller = await createTestUser('user');
    const buyer = await createTestUser('user');
    const listing = await createTestListing(seller._id);
    const auction = await createLiveAuction({
      listing: listing._id,
      state: 'closed',
      currentWinner: buyer._id,
      currentPrice: 8000,
      endsAt: new Date(Date.now() - 60_000),
    });
    const result = await AuctionResult.create({
      auctionId: auction._id,
      listingId: listing._id,
      sellerId: seller._id,
      buyerId: buyer._id,
      finalPrice: 8000,
      closedAt: new Date(),
      status: 'sale_confirmed',
    });
    const transaction = await Transaction.create({
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 8000,
      status: 'ready_for_invoice',
    });
    const snapshot = await FiscalSnapshot.create({
      transactionId: transaction._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      buyerFiscalProfile: {
        rfc: 'XAXX010101000',
        razonSocial: 'Comprador Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
        emailFacturacion: 'buyer@mg.test',
      },
      sellerFiscalProfile: {
        rfc: 'XAXX010101000',
        razonSocial: 'Vendedor Test',
        regimenFiscal: '601',
        codigoPostal: '83000',
        usoCFDI: 'G03',
        emailFacturacion: 'seller@mg.test',
      },
      amount: 8000,
      currency: 'MXN',
    });
    const draft = await InvoiceDraft.create({
      transactionId: transaction._id,
      fiscalSnapshotId: snapshot._id,
      auctionResultId: result._id,
      buyerId: buyer._id,
      sellerId: seller._id,
      amount: 8000,
      currency: 'MXN',
      status: 'ready',
      createdFromTransaction: true,
    });
    const queue = await InvoiceQueue.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      fiscalSnapshotId: snapshot._id,
      status,
      queuedAt: new Date(),
    });

    return { transaction, snapshot, draft, queue };
  }

  it('returns 401 without auth on process-next', async () => {
    const res = await request(app).post('/admin/fiscal/queue/process-next');

    expect(res.status).toBe(401);
  });

  it('returns 403 for role user on process-next', async () => {
    const token = await authToken('user');

    const res = await request(app)
      .post('/admin/fiscal/queue/process-next')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('allows admin to process next queued invoice operation', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post('/admin/fiscal/queue/process-next')
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue.status).toBe('completed');
    expect(String(res.body.invoiceQueue._id)).toBe(String(queue._id));
    expect(freshQueue?.status).toBe('completed');
  });

  it('allows super to process a specific queued invoice operation', async () => {
    const token = await authToken('super');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue.status).toBe('completed');
    expect(String(res.body.invoiceQueue._id)).toBe(String(queue._id));
  });

  it('does not process a queue that is not queued', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('completed');

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice queue is not queued' });
  });

  it('creates an invoice record and marks it completed', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(res.status).toBe(200);
    expect(record).toBeTruthy();
    expect(record?.status).toBe('completed');
    expect(record?.processedAt).toBeTruthy();
  });

  it('does not duplicate an invoice record', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const first = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await InvoiceRecord.countDocuments({ invoiceQueueId: queue._id })).toBe(1);
  });

  it('increments attempts when processing starts', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(res.status).toBe(200);
    expect(record?.attempts).toBe(1);
  });

  it('registers audit events for processing', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const actions = await Audit.find({
      action: {
        $in: [
          'INVOICE_QUEUE_CLAIMED',
          'INVOICE_PROCESSING_STARTED',
          'INVOICE_PROCESSING_COMPLETED',
        ],
      },
    }).distinct('action');

    expect(res.status).toBe(200);
    expect(actions).toEqual(expect.arrayContaining([
      'INVOICE_QUEUE_CLAIMED',
      'INVOICE_PROCESSING_STARTED',
      'INVOICE_PROCESSING_COMPLETED',
    ]));
  });

  it('lists invoice records', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const res = await request(app)
      .get('/admin/fiscal/invoice-records?status=completed')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].status).toBe('completed');
  });

  it('returns invoice record detail', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record?._id}`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body._id).toBe(String(record?._id));
    expect(res.body.status).toBe('completed');
  });

  it('returns 400 for invalid ids', async () => {
    const token = await authToken('admin');

    const processRes = await request(app)
      .post('/admin/fiscal/queue/not-an-object-id/process')
      .set('Authorization', bearer(token));
    const detailRes = await request(app)
      .get('/admin/fiscal/invoice-records/not-an-object-id')
      .set('Authorization', bearer(token));

    expect(processRes.status).toBe(400);
    expect(detailRes.status).toBe(400);
  });

  it('returns 404 for missing invoice queue and invoice record', async () => {
    const token = await authToken('admin');
    const missingId = new Types.ObjectId();

    const processRes = await request(app)
      .post(`/admin/fiscal/queue/${missingId}/process`)
      .set('Authorization', bearer(token));
    const detailRes = await request(app)
      .get(`/admin/fiscal/invoice-records/${new Types.ObjectId()}`)
      .set('Authorization', bearer(token));

    expect(processRes.status).toBe(404);
    expect(processRes.body).toEqual({ error: 'Not found' });
    expect(detailRes.status).toBe(404);
    expect(detailRes.body).toEqual({ error: 'Not found' });
  });
});
