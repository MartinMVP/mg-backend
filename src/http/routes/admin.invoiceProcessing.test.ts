import request from 'supertest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { MockFiscalProvider } from '../../domain/fiscalProviders/mockFiscalProvider';
import { processInvoiceQueue } from '../../domain/invoiceProcessing/invoiceProcessor.service';
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

  afterEach(() => {
    vi.restoreAllMocks();
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
    expect(record?.providerName).toBe('mock');
    expect(record?.providerStatus).toBe('issued');
    expect(record?.providerMessage).toBe('Mock invoice issued');
    expect(record?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
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

  it('marks record failed, resets queue, stores lastError, and audits failed when processing throws during audit', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('Audit unavailable'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const failedAudit = await Audit.findOne({ action: 'INVOICE_PROCESSING_FAILED' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Audit unavailable');
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Audit unavailable');
    expect(failedAudit).toBeTruthy();
  });

  it('marks record failed and resets queue when invoice record creation throws', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(InvoiceRecord, 'findOneAndUpdate').mockRejectedValueOnce(new Error('Record unavailable'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const failedAudit = await Audit.findOne({ action: 'INVOICE_PROCESSING_FAILED' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Record unavailable');
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Record unavailable');
    expect(failedAudit).toBeTruthy();
  });

  it('cleans lastError on retry after a failed processing attempt', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    vi.spyOn(InvoiceRecord, 'findOneAndUpdate').mockRejectedValueOnce(new Error('First attempt failed'));

    const first = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const second = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id }).lean();
    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(first.status).toBe(500);
    expect(second.status).toBe(200);
    expect(freshQueue?.status).toBe('completed');
    expect(record?.status).toBe('completed');
    expect(record?.attempts).toBe(2);
    expect(record?.lastError).toBeUndefined();
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

  it('protects invoice processing operation endpoints', async () => {
    const token = await authToken('user');
    const { queue } = await createQueuedInvoice();
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'Retryable',
    });

    const noAuth = await request(app).post(`/admin/fiscal/invoice-records/${record._id}/retry`);
    const userRetry = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));
    const userCancel = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const userRecover = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userRetry.status).toBe(403);
    expect(userCancel.status).toBe(403);
    expect(userRecover.status).toBe(403);
  });

  it('allows retry only for failed records', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record?._id}/retry`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record is not failed' });
  });

  it('retries a failed record without duplicating records or incrementing attempts', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Temporary failure',
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_PROCESSING_RETRY_REQUESTED' });

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('queued');
    expect(freshRecord?.attempts).toBe(2);
    expect(freshRecord?.lastError).toBeUndefined();
    expect(await InvoiceRecord.countDocuments({ invoiceQueueId: queue._id })).toBe(1);
    expect(audit).toBeTruthy();
  });

  it('does not increment retry attempts until processing runs again', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'Retryable',
    });

    const retry = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/retry`)
      .set('Authorization', bearer(token));
    const afterRetry = await InvoiceRecord.findById(record._id).lean();
    const process = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));
    const afterProcess = await InvoiceRecord.findById(record._id).lean();

    expect(retry.status).toBe(200);
    expect(afterRetry?.attempts).toBe(1);
    expect(process.status).toBe(200);
    expect(afterProcess?.attempts).toBe(2);
  });

  it('cancels a queued invoice queue', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const audit = await Audit.findOne({ action: 'INVOICE_QUEUE_CANCELLED' });

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('cancelled');
    expect(audit).toBeTruthy();
  });

  it('cancels a processing invoice queue and marks its record failed', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'processing',
      attempts: 1,
    });

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const freshRecord = await InvoiceRecord.findById(record._id);

    expect(res.status).toBe(200);
    expect(freshQueue?.status).toBe('cancelled');
    expect(freshRecord?.status).toBe('failed');
    expect(freshRecord?.lastError).toBe('Cancelled by admin');
  });

  it('does not cancel a completed invoice queue', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('completed');

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice queue cannot be cancelled' });
  });

  it('recovers old processing queues without processing them', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');
    await InvoiceQueue.collection.updateOne(
      { _id: queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const audit = await Audit.findOne({ action: 'INVOICE_QUEUE_RECOVERED' });

    expect(res.status).toBe(200);
    expect(res.body.recoveredCount).toBe(1);
    expect(freshQueue?.status).toBe('queued');
    expect(audit).toBeTruthy();
  });

  it('does not recover recent processing queues', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice('processing');

    const res = await request(app)
      .post('/admin/fiscal/queue/recover-stuck')
      .set('Authorization', bearer(token));
    const freshQueue = await InvoiceQueue.findById(queue._id);

    expect(res.status).toBe(200);
    expect(res.body.recoveredCount).toBe(0);
    expect(freshQueue?.status).toBe('processing');
  });

  it('cancels the queue when max processing attempts is reached', async () => {
    const token = await authToken('admin');
    const { queue } = await createQueuedInvoice();
    await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Previous failure',
    });
    vi.spyOn(Audit, 'create').mockRejectedValueOnce(new Error('Final failure'));

    const res = await request(app)
      .post(`/admin/fiscal/queue/${queue._id}/process`)
      .set('Authorization', bearer(token));

    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
    const actions = await Audit.find({
      action: {
        $in: [
          'INVOICE_PROCESSING_FAILED',
          'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED',
        ],
      },
    }).distinct('action');

    expect(res.status).toBe(500);
    expect(freshQueue?.status).toBe('cancelled');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(3);
    expect(record?.lastError).toBe('Final failure');
    expect(actions).toEqual(expect.arrayContaining([
      'INVOICE_PROCESSING_FAILED',
      'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED',
    ]));
  });

  it('protects processing monitoring endpoints', async () => {
    const token = await authToken('user');

    const noAuth = await request(app).get('/admin/fiscal/processing/summary');
    const userSummary = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));
    const userFailures = await request(app)
      .get('/admin/fiscal/processing/failures')
      .set('Authorization', bearer(token));
    const userStuck = await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userSummary.status).toBe(403);
    expect(userFailures.status).toBe(403);
    expect(userStuck.status).toBe(403);
  });

  it('allows admin and super to read processing summary', async () => {
    const adminToken = await authToken('admin');
    const superToken = await authToken('super');

    const adminRes = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(adminToken));
    const superRes = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(superToken));

    expect(adminRes.status).toBe(200);
    expect(superRes.status).toBe(200);
  });

  it('summarizes invoice queue and invoice record status counts', async () => {
    const token = await authToken('admin');
    const queued = await createQueuedInvoice('queued');
    const processing = await createQueuedInvoice('processing');
    const completed = await createQueuedInvoice('completed');
    const cancelled = await createQueuedInvoice('cancelled');
    await InvoiceRecord.create({
      transactionId: queued.transaction._id,
      invoiceDraftId: queued.draft._id,
      invoiceQueueId: queued.queue._id,
      status: 'created',
      attempts: 0,
    });
    await InvoiceRecord.create({
      transactionId: processing.transaction._id,
      invoiceDraftId: processing.draft._id,
      invoiceQueueId: processing.queue._id,
      status: 'processing',
      attempts: 1,
    });
    await InvoiceRecord.create({
      transactionId: completed.transaction._id,
      invoiceDraftId: completed.draft._id,
      invoiceQueueId: completed.queue._id,
      status: 'completed',
      attempts: 2,
      processedAt: new Date(),
    });
    await InvoiceRecord.create({
      transactionId: cancelled.transaction._id,
      invoiceDraftId: cancelled.draft._id,
      invoiceQueueId: cancelled.queue._id,
      status: 'failed',
      attempts: 3,
      lastError: 'Failed',
    });
    await InvoiceQueue.collection.updateOne(
      { _id: processing.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue).toMatchObject({
      queued: 1,
      processing: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(res.body.invoiceRecord).toMatchObject({
      created: 1,
      processing: 1,
      completed: 1,
      failed: 1,
    });
    expect(res.body.totalAttempts).toBe(6);
    expect(res.body.failedRecords).toBe(1);
    expect(res.body.queuesStuckProcessing).toBe(1);
    expect(res.body.oldestQueuedAt).toBeTruthy();
    expect(res.body.latestProcessedAt).toBeTruthy();
  });

  it('lists only failed invoice records with pagination', async () => {
    const token = await authToken('admin');
    const first = await createQueuedInvoice('processing');
    const second = await createQueuedInvoice('processing');
    const third = await createQueuedInvoice('processing');
    await InvoiceRecord.create({
      transactionId: first.transaction._id,
      invoiceDraftId: first.draft._id,
      invoiceQueueId: first.queue._id,
      status: 'failed',
      attempts: 1,
      lastError: 'First',
    });
    await InvoiceRecord.create({
      transactionId: second.transaction._id,
      invoiceDraftId: second.draft._id,
      invoiceQueueId: second.queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Second',
    });
    await InvoiceRecord.create({
      transactionId: third.transaction._id,
      invoiceDraftId: third.draft._id,
      invoiceQueueId: third.queue._id,
      status: 'completed',
      attempts: 1,
    });

    const res = await request(app)
      .get('/admin/fiscal/processing/failures?page=1&limit=1')
      .set('Authorization', bearer(token));
    const secondPage = await request(app)
      .get('/admin/fiscal/processing/failures?page=2&limit=1')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].invoiceRecord.status).toBe('failed');
    expect(res.body.items[0].invoiceQueue).toBeTruthy();
    expect(res.body.items[0].transactionId).toBeTruthy();
    expect(res.body.items[0].attempts).toBeGreaterThan(0);
    expect(res.body.items[0].lastError).toBeTruthy();
    expect(res.body.items[0].updatedAt).toBeTruthy();
    expect(secondPage.status).toBe(200);
    expect(secondPage.body.items).toHaveLength(1);
    expect(secondPage.body.items[0].invoiceRecord.status).toBe('failed');
  });

  it('lists only old processing queues as stuck', async () => {
    const token = await authToken('admin');
    const oldProcessing = await createQueuedInvoice('processing');
    const recentProcessing = await createQueuedInvoice('processing');
    const queued = await createQueuedInvoice('queued');
    await InvoiceQueue.collection.updateOne(
      { _id: oldProcessing.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );
    await InvoiceQueue.collection.updateOne(
      { _id: recentProcessing.queue._id },
      { $set: { updatedAt: new Date() } }
    );
    await InvoiceQueue.collection.updateOne(
      { _id: queued.queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const res = await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]._id).toBe(String(oldProcessing.queue._id));
    expect(res.body.items[0].status).toBe('processing');
  });

  it('does not modify queues or records when reading monitoring endpoints', async () => {
    const token = await authToken('admin');
    const { queue, transaction, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Still failed',
    });
    await InvoiceQueue.collection.updateOne(
      { _id: queue._id },
      { $set: { updatedAt: new Date(Date.now() - 16 * 60_000) } }
    );

    const beforeQueue = await InvoiceQueue.findById(queue._id).lean();
    const beforeRecord = await InvoiceRecord.findById(record._id).lean();

    await request(app)
      .get('/admin/fiscal/processing/summary')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/processing/failures')
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/processing/stuck')
      .set('Authorization', bearer(token));

    const afterQueue = await InvoiceQueue.findById(queue._id).lean();
    const afterRecord = await InvoiceRecord.findById(record._id).lean();

    expect(afterQueue?.status).toBe(beforeQueue?.status);
    expect(afterQueue?.processedAt).toEqual(beforeQueue?.processedAt);
    expect(afterRecord?.status).toBe(beforeRecord?.status);
    expect(afterRecord?.attempts).toBe(beforeRecord?.attempts);
    expect(afterRecord?.lastError).toBe(beforeRecord?.lastError);
  });

  it('protects processing history and analytics endpoints', async () => {
    const token = await authToken('user');
    const { transaction, queue, draft } = await createQueuedInvoice();
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 1,
    });

    const noAuth = await request(app).get(`/admin/fiscal/transactions/${transaction._id}/history`);
    const userTransactionHistory = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));
    const userRecordHistory = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));
    const userAnalytics = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    expect(noAuth.status).toBe(401);
    expect(userTransactionHistory.status).toBe(403);
    expect(userRecordHistory.status).toBe(403);
    expect(userAnalytics.status).toBe(403);
  });

  it('allows admin and super to read processing analytics', async () => {
    const adminToken = await authToken('admin');
    const superToken = await authToken('super');

    const adminRes = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(adminToken));
    const superRes = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(superToken));

    expect(adminRes.status).toBe(200);
    expect(superRes.status).toBe(200);
  });

  it('returns complete fiscal history for a transaction', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft, snapshot } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });
    await Audit.create({ actor: 'system', action: 'INVOICE_PROCESSING_COMPLETED' });

    const res = await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.transaction._id).toBe(String(transaction._id));
    expect(res.body.fiscalSnapshot._id).toBe(String(snapshot._id));
    expect(res.body.invoiceDraft._id).toBe(String(draft._id));
    expect(res.body.invoiceQueues.map((item: any) => item._id)).toContain(String(queue._id));
    expect(res.body.invoiceRecords.map((item: any) => item._id)).toContain(String(record._id));
    expect(res.body.auditEvents.map((event: any) => event.action)).toContain('INVOICE_PROCESSING_COMPLETED');
  });

  it('returns complete fiscal history for an invoice record', async () => {
    const token = await authToken('super');
    const { transaction, queue, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Failed',
    });
    await Audit.create({ actor: 'system', action: 'INVOICE_PROCESSING_FAILED' });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceRecord._id).toBe(String(record._id));
    expect(res.body.invoiceQueue._id).toBe(String(queue._id));
    expect(res.body.transaction._id).toBe(String(transaction._id));
    expect(res.body.auditEvents.map((event: any) => event.action)).toContain('INVOICE_PROCESSING_FAILED');
  });

  it('returns processing analytics with correct counts and rates', async () => {
    const token = await authToken('admin');
    const queued = await createQueuedInvoice('queued');
    const processing = await createQueuedInvoice('processing');
    const completed = await createQueuedInvoice('completed');
    const cancelled = await createQueuedInvoice('cancelled');
    await InvoiceRecord.create({
      transactionId: queued.transaction._id,
      invoiceDraftId: queued.draft._id,
      invoiceQueueId: queued.queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });
    await InvoiceRecord.create({
      transactionId: processing.transaction._id,
      invoiceDraftId: processing.draft._id,
      invoiceQueueId: processing.queue._id,
      status: 'completed',
      attempts: 2,
      processedAt: new Date(Date.now() - 2 * 24 * 60 * 60_000),
    });
    await InvoiceRecord.create({
      transactionId: completed.transaction._id,
      invoiceDraftId: completed.draft._id,
      invoiceQueueId: completed.queue._id,
      status: 'failed',
      attempts: 3,
      lastError: 'Failed',
    });
    await InvoiceRecord.create({
      transactionId: cancelled.transaction._id,
      invoiceDraftId: cancelled.draft._id,
      invoiceQueueId: cancelled.queue._id,
      status: 'processing',
      attempts: 4,
    });

    const res = await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceQueue).toMatchObject({
      total: 4,
      queued: 1,
      processing: 1,
      completed: 1,
      cancelled: 1,
    });
    expect(res.body.invoiceRecord).toMatchObject({
      total: 4,
      completed: 2,
      failed: 1,
    });
    expect(res.body.successRate).toBe(50);
    expect(res.body.failureRate).toBe(25);
    expect(res.body.averageAttempts).toBe(2.5);
    expect(res.body.maxAttemptsObserved).toBe(4);
    expect(res.body.processedLast24h).toBe(1);
    expect(res.body.processedLast7d).toBe(2);
    expect(res.body.processedLast30d).toBe(2);
  });

  it('does not modify documents when reading history and analytics endpoints', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('processing');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Still failed',
    });
    const beforeTransaction = await Transaction.findById(transaction._id).lean();
    const beforeQueue = await InvoiceQueue.findById(queue._id).lean();
    const beforeRecord = await InvoiceRecord.findById(record._id).lean();

    await request(app)
      .get(`/admin/fiscal/transactions/${transaction._id}/history`)
      .set('Authorization', bearer(token));
    await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));
    await request(app)
      .get('/admin/fiscal/analytics/processing')
      .set('Authorization', bearer(token));

    const afterTransaction = await Transaction.findById(transaction._id).lean();
    const afterQueue = await InvoiceQueue.findById(queue._id).lean();
    const afterRecord = await InvoiceRecord.findById(record._id).lean();

    expect(afterTransaction?.status).toBe(beforeTransaction?.status);
    expect(afterQueue?.status).toBe(beforeQueue?.status);
    expect(afterQueue?.processedAt).toEqual(beforeQueue?.processedAt);
    expect(afterRecord?.status).toBe(beforeRecord?.status);
    expect(afterRecord?.attempts).toBe(beforeRecord?.attempts);
    expect(afterRecord?.lastError).toBe(beforeRecord?.lastError);
  });

  it('mock fiscal provider validates, issues, and cancels without real fiscal artifacts', async () => {
    const { transaction, queue, draft } = await createQueuedInvoice();
    const provider = new MockFiscalProvider();
    const input = {
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
    };

    const validation = await provider.validateInvoiceInput(input);
    const issue = await provider.issueInvoice(input);
    const cancellation = await provider.cancelInvoice(input);

    expect(validation).toEqual({ ok: true, message: 'Mock validation successful' });
    expect(issue).toMatchObject({
      ok: true,
      providerStatus: 'issued',
      providerMessage: 'Mock invoice issued',
      simulatedExternalId: `mock-${String(queue._id)}`,
    });
    expect(cancellation).toEqual({
      ok: true,
      providerStatus: 'cancelled',
      providerMessage: 'Mock cancellation successful',
    });
    expect(JSON.stringify(issue)).not.toContain('xml');
    expect(JSON.stringify(issue)).not.toContain('pdf');
    expect(issue.simulatedExternalId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('mock fiscal provider can return a controlled issue failure', async () => {
    const { transaction, queue, draft } = await createQueuedInvoice();
    const provider = new MockFiscalProvider({ issueShouldFail: true });

    const issue = await provider.issueInvoice({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
    });

    expect(issue).toEqual({
      ok: false,
      providerStatus: 'failed',
      providerMessage: 'Mock invoice issue failed',
    });
  });

  it('invoice processor stores provider metadata from the mock provider', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
      provider: new MockFiscalProvider(),
    });
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id }).lean();

    expect(result.ok).toBe(true);
    expect(record?.providerName).toBe('mock');
    expect(record?.providerStatus).toBe('issued');
    expect(record?.providerMessage).toBe('Mock invoice issued');
    expect(record?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
    expect(record).not.toHaveProperty('xml');
    expect(record).not.toHaveProperty('pdf');
    expect(record?.simulatedExternalId).not.toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('provider failure leaves queue retryable before max attempts', async () => {
    const { queue } = await createQueuedInvoice();

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(false);
    expect(freshQueue?.status).toBe('queued');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(1);
    expect(record?.lastError).toBe('Mock invoice issue failed');
    expect(record?.providerName).toBe('mock');
    expect(record?.providerStatus).toBe('failed');
    expect(record?.providerMessage).toBe('Mock invoice issue failed');
  });

  it('provider failure cancels queue when max attempts is reached', async () => {
    const { queue } = await createQueuedInvoice();
    await InvoiceRecord.create({
      transactionId: queue.transactionId,
      invoiceDraftId: queue.invoiceDraftId,
      invoiceQueueId: queue._id,
      status: 'failed',
      attempts: 2,
      lastError: 'Previous provider failure',
    });

    const result = await processInvoiceQueue({
      invoiceQueueId: queue._id,
      actor: 'system',
      provider: new MockFiscalProvider({ issueShouldFail: true }),
    });
    const freshQueue = await InvoiceQueue.findById(queue._id);
    const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });

    expect(result.ok).toBe(false);
    expect(freshQueue?.status).toBe('cancelled');
    expect(record?.status).toBe('failed');
    expect(record?.attempts).toBe(3);
    expect(record?.lastError).toBe('Mock invoice issue failed');
    expect(record?.providerStatus).toBe('failed');
  });

  it('issues a completed invoice record through the mock lifecycle', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      processedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_ISSUED' });

    expect(res.status).toBe(200);
    expect(freshRecord?.lifecycleStatus).toBe('issued');
    expect(freshRecord?.issuedAt).toBeTruthy();
    expect(freshRecord?.providerName).toBe('mock');
    expect(freshRecord?.providerStatus).toBe('issued');
    expect(freshRecord?.providerMessage).toBe('Mock invoice issued');
    expect(freshRecord?.simulatedExternalId).toBe(`mock-${String(queue._id)}`);
    expect(audit).toBeTruthy();
  });

  it('blocks duplicate invoice record issue', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record already issued' });
  });

  it('cancels an issued invoice record through the mock lifecycle', async () => {
    const token = await authToken('super');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));
    const freshRecord = await InvoiceRecord.findById(record._id).lean();
    const audit = await Audit.findOne({ action: 'INVOICE_CANCELLED' });

    expect(res.status).toBe(200);
    expect(freshRecord?.lifecycleStatus).toBe('cancelled');
    expect(freshRecord?.cancelledAt).toBeTruthy();
    expect(freshRecord?.providerName).toBe('mock');
    expect(freshRecord?.providerStatus).toBe('cancelled');
    expect(freshRecord?.providerMessage).toBe('Mock cancellation successful');
    expect(audit).toBeTruthy();
  });

  it('blocks duplicate invoice record cancellation', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'cancelled',
      issuedAt: new Date(),
      cancelledAt: new Date(),
    });

    const res = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Invoice record already cancelled' });
  });

  it('protects invoice record lifecycle endpoints', async () => {
    const token = await authToken('user');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
    });

    const noAuthIssue = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`);
    const userIssue = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/issue`)
      .set('Authorization', bearer(token));
    const userCancel = await request(app)
      .post(`/admin/fiscal/invoice-records/${record._id}/cancel`)
      .set('Authorization', bearer(token));

    expect(noAuthIssue.status).toBe(401);
    expect(userIssue.status).toBe(403);
    expect(userCancel.status).toBe(403);
  });

  it('returns lifecycle status in invoice record history', async () => {
    const token = await authToken('admin');
    const { transaction, queue, draft } = await createQueuedInvoice('completed');
    const record = await InvoiceRecord.create({
      transactionId: transaction._id,
      invoiceDraftId: draft._id,
      invoiceQueueId: queue._id,
      status: 'completed',
      attempts: 1,
      lifecycleStatus: 'issued',
      issuedAt: new Date(),
    });

    const res = await request(app)
      .get(`/admin/fiscal/invoice-records/${record._id}/history`)
      .set('Authorization', bearer(token));

    expect(res.status).toBe(200);
    expect(res.body.invoiceRecord.lifecycleStatus).toBe('issued');
    expect(res.body.invoiceRecord.issuedAt).toBeTruthy();
  });
});
