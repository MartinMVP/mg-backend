import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { AuctionResultStatus, AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { Audit } from '../../domain/audit/audit.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { mockFiscalProvider } from '../../domain/fiscalProviders/mockFiscalProvider';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
import { InvoiceRecord } from '../../domain/invoiceRecords/invoiceRecord.model';
import { processInvoiceQueue } from '../../domain/invoiceProcessing/invoiceProcessor.service';
import { InvoiceQueue } from '../../domain/invoiceQueue/invoiceQueue.model';
import { recoverFiscalTransaction } from '../../domain/fiscalRecovery/fiscalRecovery.service';
import { evaluateFiscalReadiness } from '../../domain/fiscalReadiness/fiscalReadiness.service';
import { Transaction, TransactionStatus } from '../../domain/transactions/transaction.model';
import { Types } from 'mongoose';

const router = Router();
const resultStatuses: AuctionResultStatus[] = [
  'pending_contact',
  'contacted',
  'sale_confirmed',
  'sale_cancelled',
  'in_dispute',
];
const transactionStatuses: TransactionStatus[] = [
  'pending',
  'ready_for_invoice',
  'invoiced',
  'cancelled',
];
const invoiceRecordStatuses = ['created', 'processing', 'completed', 'failed'];
const invoiceQueueStatuses = ['queued', 'processing', 'completed', 'cancelled'];
const STUCK_PROCESSING_THRESHOLD_MS = 15 * 60_000;
const invoiceAuditActions = [
  'INVOICE_QUEUE_CLAIMED',
  'INVOICE_PROCESSING_STARTED',
  'INVOICE_PROCESSING_COMPLETED',
  'INVOICE_PROCESSING_FAILED',
  'INVOICE_PROCESSING_MAX_ATTEMPTS_REACHED',
  'INVOICE_PROCESSING_RETRY_REQUESTED',
  'INVOICE_QUEUE_CANCELLED',
  'INVOICE_QUEUE_RECOVERED',
  'INVOICE_ISSUED',
  'INVOICE_CANCELLED',
];

function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

  return { page, limit };
}

function addObjectIdFilter(filter: Record<string, unknown>, key: string, value: unknown) {
  if (typeof value !== 'string' || !value) return true;
  if (!Types.ObjectId.isValid(value)) return false;

  filter[key] = new Types.ObjectId(value);
  return true;
}

function countsFromAggregation(statuses: string[], rows: Array<{ _id: string; count: number }>) {
  const counts = Object.fromEntries(statuses.map((status) => [status, 0]));
  for (const row of rows) {
    counts[row._id] = row.count;
  }

  return counts;
}

function percentage(part: number, total: number) {
  if (total <= 0) return 0;
  return Math.round((part / total) * 10_000) / 100;
}

function invoiceAuditFilter(refs: {
  transactionId?: unknown;
  invoiceRecordId?: unknown;
  invoiceQueueId?: unknown;
}) {
  const directRefs: Record<string, unknown>[] = [];

  if (refs.transactionId) directRefs.push({ transactionId: refs.transactionId });
  if (refs.invoiceRecordId) directRefs.push({ invoiceRecordId: refs.invoiceRecordId });
  if (refs.invoiceQueueId) directRefs.push({ invoiceQueueId: refs.invoiceQueueId });

  return {
    action: { $in: invoiceAuditActions },
    $or: [
      ...directRefs,
      {
        transactionId: { $exists: false },
        invoiceRecordId: { $exists: false },
        invoiceQueueId: { $exists: false },
      },
    ],
  };
}

// Solo admin y super
router.get('/ping', requireAuth, requireRole('admin', 'super'), (_req, res) => {
  res.json({ ok: true, area: 'admin', ts: new Date().toISOString() });
});

router.get('/fiscal/analytics/processing', requireAuth, requireRole('admin', 'super'), async (_req, res) => {
  const now = Date.now();
  const last24h = new Date(now - 24 * 60 * 60_000);
  const last7d = new Date(now - 7 * 24 * 60 * 60_000);
  const last30d = new Date(now - 30 * 24 * 60 * 60_000);
  const [
    queueRows,
    recordRows,
    attemptsRows,
    maxAttemptsRows,
    processedLast24h,
    processedLast7d,
    processedLast30d,
  ] = await Promise.all([
    InvoiceQueue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    InvoiceRecord.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    InvoiceRecord.aggregate([{ $group: { _id: null, total: { $sum: '$attempts' }, count: { $sum: 1 } } }]),
    InvoiceRecord.aggregate([{ $group: { _id: null, max: { $max: '$attempts' } } }]),
    InvoiceRecord.countDocuments({ status: 'completed', processedAt: { $gte: last24h } }),
    InvoiceRecord.countDocuments({ status: 'completed', processedAt: { $gte: last7d } }),
    InvoiceRecord.countDocuments({ status: 'completed', processedAt: { $gte: last30d } }),
  ]);
  const queueCounts = countsFromAggregation(invoiceQueueStatuses, queueRows);
  const recordCounts = countsFromAggregation(invoiceRecordStatuses, recordRows);
  const invoiceRecordTotal = Object.values(recordCounts).reduce((total: number, count: any) => total + count, 0);
  const completedRecords = Number((recordCounts as any).completed || 0);
  const failedRecords = Number((recordCounts as any).failed || 0);
  const attemptsSummary = attemptsRows[0] || { total: 0, count: 0 };

  res.json({
    invoiceQueue: {
      total: Object.values(queueCounts).reduce((total: number, count: any) => total + count, 0),
      ...queueCounts,
    },
    invoiceRecord: {
      total: invoiceRecordTotal,
      completed: completedRecords,
      failed: failedRecords,
    },
    successRate: percentage(completedRecords, invoiceRecordTotal),
    failureRate: percentage(failedRecords, invoiceRecordTotal),
    averageAttempts: attemptsSummary.count ? attemptsSummary.total / attemptsSummary.count : 0,
    maxAttemptsObserved: maxAttemptsRows[0]?.max || 0,
    processedLast24h,
    processedLast7d,
    processedLast30d,
  });
});

router.get('/fiscal/processing/summary', requireAuth, requireRole('admin', 'super'), async (_req, res) => {
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);
  const [
    queueRows,
    recordRows,
    attemptsRows,
    failedRecords,
    queuesStuckProcessing,
    oldestQueued,
    latestProcessed,
  ] = await Promise.all([
    InvoiceQueue.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    InvoiceRecord.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    InvoiceRecord.aggregate([{ $group: { _id: null, total: { $sum: '$attempts' } } }]),
    InvoiceRecord.countDocuments({ status: 'failed' }),
    InvoiceQueue.countDocuments({ status: 'processing', updatedAt: { $lt: cutoff } }),
    InvoiceQueue.findOne({ status: 'queued' }).sort({ queuedAt: 1 }).select('queuedAt').lean(),
    InvoiceRecord.findOne({ processedAt: { $exists: true } }).sort({ processedAt: -1 }).select('processedAt').lean(),
  ]);

  res.json({
    invoiceQueue: countsFromAggregation(invoiceQueueStatuses, queueRows),
    invoiceRecord: countsFromAggregation(invoiceRecordStatuses, recordRows),
    totalAttempts: attemptsRows[0]?.total || 0,
    failedRecords,
    queuesStuckProcessing,
    oldestQueuedAt: oldestQueued?.queuedAt || null,
    latestProcessedAt: latestProcessed?.processedAt || null,
  });
});

router.get('/fiscal/processing/failures', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const records = await InvoiceRecord.find({ status: 'failed' })
    .sort({ updatedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();
  const queueIds = records.map((record) => record.invoiceQueueId);
  const queues = await InvoiceQueue.find({ _id: { $in: queueIds } }).lean();
  const queuesById = new Map(queues.map((queue: any) => [String(queue._id), queue]));

  res.json({
    page,
    limit,
    items: records.map((record: any) => ({
      invoiceRecord: record,
      invoiceQueue: queuesById.get(String(record.invoiceQueueId)) || null,
      transactionId: record.transactionId,
      attempts: record.attempts,
      lastError: record.lastError,
      updatedAt: record.updatedAt,
    })),
  });
});

router.get('/fiscal/processing/stuck', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const cutoff = new Date(Date.now() - STUCK_PROCESSING_THRESHOLD_MS);
  const items = await InvoiceQueue.find({ status: 'processing', updatedAt: { $lt: cutoff } })
    .sort({ updatedAt: 1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({ page, limit, items });
});

router.get('/fiscal/invoice-records/:id/history', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice record id' });
  }

  const invoiceRecord = await InvoiceRecord.findById(id).lean();
  if (!invoiceRecord) return res.status(404).json({ error: 'Not found' });

  const [invoiceQueue, transaction, auditEvents] = await Promise.all([
    InvoiceQueue.findById(invoiceRecord.invoiceQueueId).lean(),
    Transaction.findById(invoiceRecord.transactionId).lean(),
    Audit.find(invoiceAuditFilter({
      transactionId: invoiceRecord.transactionId,
      invoiceRecordId: invoiceRecord._id,
      invoiceQueueId: invoiceRecord.invoiceQueueId,
    })).sort({ createdAt: -1 }).limit(100).lean(),
  ]);

  res.json({
    invoiceRecord,
    invoiceQueue,
    transaction,
    auditEvents,
  });
});

router.post('/fiscal/queue/process-next', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const result = await processInvoiceQueue({ actor: user?.sub });

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({
    invoiceQueue: result.invoiceQueue,
    invoiceRecord: result.invoiceRecord,
  });
});

router.post('/fiscal/queue/recover-stuck', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const cutoff = new Date(Date.now() - 15 * 60_000);
  const stuckQueues = await InvoiceQueue.find({
    status: 'processing',
    updatedAt: { $lt: cutoff },
  }).select('_id');
  const ids = stuckQueues.map((queue) => queue._id);

  if (ids.length > 0) {
    await InvoiceQueue.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'queued' } },
      { runValidators: true }
    );
    await Audit.create({ actor: user?.sub || 'system', action: 'INVOICE_QUEUE_RECOVERED' });
  }

  res.json({ recoveredCount: ids.length });
});

router.post('/fiscal/queue/:id/process', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const result = await processInvoiceQueue({
    invoiceQueueId: String(req.params.id),
    actor: user?.sub,
  });

  if (!result.ok) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({
    invoiceQueue: result.invoiceQueue,
    invoiceRecord: result.invoiceRecord,
  });
});

router.post('/fiscal/queue/:id/cancel', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice queue id' });
  }

  const queue = await InvoiceQueue.findById(id);
  if (!queue) return res.status(404).json({ error: 'Not found' });
  if (!['queued', 'processing'].includes(queue.status)) {
    return res.status(409).json({ error: 'Invoice queue cannot be cancelled' });
  }

  const cancelledQueue = await InvoiceQueue.findOneAndUpdate(
    { _id: queue._id, status: { $in: ['queued', 'processing'] } },
    { $set: { status: 'cancelled' } },
    { new: true, runValidators: true }
  );
  if (!cancelledQueue) {
    return res.status(409).json({ error: 'Invoice queue cannot be cancelled' });
  }

  const record = await InvoiceRecord.findOne({ invoiceQueueId: queue._id });
  const invoiceRecord = record && record.status !== 'completed'
    ? await InvoiceRecord.findByIdAndUpdate(
        record._id,
        { $set: { status: 'failed', lastError: 'Cancelled by admin' } },
        { new: true, runValidators: true }
      )
    : record;

  await Audit.create({ actor: user?.sub || 'system', action: 'INVOICE_QUEUE_CANCELLED' });

  res.json({ invoiceQueue: cancelledQueue, invoiceRecord });
});

router.post('/fiscal/invoice-records/:id/retry', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice record id' });
  }

  const record = await InvoiceRecord.findById(id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.status !== 'failed') {
    return res.status(409).json({ error: 'Invoice record is not failed' });
  }

  const queue = await InvoiceQueue.findById(record.invoiceQueueId);
  if (!queue) return res.status(404).json({ error: 'Invoice queue not found' });
  if (['cancelled', 'completed'].includes(queue.status)) {
    return res.status(409).json({ error: 'Invoice queue cannot be retried' });
  }

  const invoiceQueue = await InvoiceQueue.findOneAndUpdate(
    { _id: queue._id, status: { $nin: ['cancelled', 'completed'] } },
    { $set: { status: 'queued' } },
    { new: true, runValidators: true }
  );
  if (!invoiceQueue) {
    return res.status(409).json({ error: 'Invoice queue cannot be retried' });
  }

  const invoiceRecord = await InvoiceRecord.findByIdAndUpdate(
    record._id,
    { $unset: { lastError: '' } },
    { new: true, runValidators: true }
  );

  await Audit.create({ actor: user?.sub || 'system', action: 'INVOICE_PROCESSING_RETRY_REQUESTED' });

  res.json({ invoiceQueue, invoiceRecord });
});

router.post('/fiscal/invoice-records/:id/issue', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice record id' });
  }

  const record = await InvoiceRecord.findById(id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.status !== 'completed') {
    return res.status(409).json({ error: 'Invoice record is not completed' });
  }
  if (record.lifecycleStatus === 'issued') {
    return res.status(409).json({ error: 'Invoice record already issued' });
  }
  if (record.lifecycleStatus === 'issuing') {
    return res.status(409).json({ error: 'Invoice record is already issuing' });
  }
  if (record.lifecycleStatus === 'cancelled') {
    return res.status(409).json({ error: 'Invoice record is cancelled' });
  }

  const issuingRecord = await InvoiceRecord.findOneAndUpdate(
    {
      _id: record._id,
      status: 'completed',
      $or: [
        { lifecycleStatus: { $exists: false } },
        { lifecycleStatus: 'pending' },
      ],
    },
    { $set: { lifecycleStatus: 'issuing' } },
    { new: true, runValidators: true }
  );
  if (!issuingRecord) {
    return res.status(409).json({ error: 'Invoice record cannot be issued' });
  }

  const issueResult = await mockFiscalProvider.issueInvoice({
    transactionId: issuingRecord.transactionId,
    invoiceDraftId: issuingRecord.invoiceDraftId,
    invoiceQueueId: issuingRecord.invoiceQueueId,
  });
  if (!issueResult.ok) {
    await InvoiceRecord.findOneAndUpdate(
      { _id: issuingRecord._id, lifecycleStatus: 'issuing' },
      {
        $set: {
          lifecycleStatus: 'pending',
          providerName: mockFiscalProvider.name,
          providerStatus: issueResult.providerStatus,
          providerMessage: issueResult.providerMessage,
        },
      },
      { runValidators: true }
    );
    return res.status(409).json({ error: issueResult.providerMessage });
  }

  const invoiceRecord = await InvoiceRecord.findOneAndUpdate(
    { _id: issuingRecord._id, status: 'completed', lifecycleStatus: 'issuing' },
    {
      $set: {
        lifecycleStatus: 'issued',
        issuedAt: new Date(),
        providerName: mockFiscalProvider.name,
        providerStatus: issueResult.providerStatus,
        providerMessage: issueResult.providerMessage,
        simulatedExternalId: issueResult.simulatedExternalId,
      },
    },
    { new: true, runValidators: true }
  );
  if (!invoiceRecord) {
    return res.status(409).json({ error: 'Invoice record cannot be issued' });
  }

  await Audit.create({
    actor: user?.sub || 'system',
    action: 'INVOICE_ISSUED',
    transactionId: invoiceRecord.transactionId,
    invoiceRecordId: invoiceRecord._id,
    invoiceQueueId: invoiceRecord.invoiceQueueId,
  });

  res.json(invoiceRecord);
});

router.post('/fiscal/invoice-records/:id/cancel', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const user = (req as any).user;
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice record id' });
  }

  const record = await InvoiceRecord.findById(id);
  if (!record) return res.status(404).json({ error: 'Not found' });
  if (record.lifecycleStatus === 'cancelled') {
    return res.status(409).json({ error: 'Invoice record already cancelled' });
  }
  if (record.lifecycleStatus === 'cancelling') {
    return res.status(409).json({ error: 'Invoice record is already cancelling' });
  }
  if (record.lifecycleStatus !== 'issued') {
    return res.status(409).json({ error: 'Invoice record is not issued' });
  }

  const cancellingRecord = await InvoiceRecord.findOneAndUpdate(
    { _id: record._id, lifecycleStatus: 'issued' },
    { $set: { lifecycleStatus: 'cancelling' } },
    { new: true, runValidators: true }
  );
  if (!cancellingRecord) {
    return res.status(409).json({ error: 'Invoice record cannot be cancelled' });
  }

  const cancelResult = await mockFiscalProvider.cancelInvoice({
    transactionId: cancellingRecord.transactionId,
    invoiceDraftId: cancellingRecord.invoiceDraftId,
    invoiceQueueId: cancellingRecord.invoiceQueueId,
  });
  if (!cancelResult.ok) {
    await InvoiceRecord.findOneAndUpdate(
      { _id: cancellingRecord._id, lifecycleStatus: 'cancelling' },
      {
        $set: {
          lifecycleStatus: 'issued',
          providerName: mockFiscalProvider.name,
          providerStatus: cancelResult.providerStatus,
          providerMessage: cancelResult.providerMessage,
        },
      },
      { runValidators: true }
    );
    return res.status(409).json({ error: cancelResult.providerMessage });
  }

  const invoiceRecord = await InvoiceRecord.findOneAndUpdate(
    { _id: cancellingRecord._id, lifecycleStatus: 'cancelling' },
    {
      $set: {
        lifecycleStatus: 'cancelled',
        cancelledAt: new Date(),
        providerName: mockFiscalProvider.name,
        providerStatus: cancelResult.providerStatus,
        providerMessage: cancelResult.providerMessage,
      },
    },
    { new: true, runValidators: true }
  );
  if (!invoiceRecord) {
    return res.status(409).json({ error: 'Invoice record cannot be cancelled' });
  }

  await Audit.create({
    actor: user?.sub || 'system',
    action: 'INVOICE_CANCELLED',
    transactionId: invoiceRecord.transactionId,
    invoiceRecordId: invoiceRecord._id,
    invoiceQueueId: invoiceRecord.invoiceQueueId,
  });

  res.json(invoiceRecord);
});

router.get('/fiscal/invoice-records', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const { page, limit } = parsePagination(req.query);
  const filter: Record<string, unknown> = {};

  if (status && invoiceRecordStatuses.includes(status)) {
    filter.status = status;
  }

  for (const key of ['transactionId', 'invoiceQueueId']) {
    if (!addObjectIdFilter(filter, key, req.query[key])) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  const items = await InvoiceRecord.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .lean();

  res.json({ page, limit, items });
});

router.get('/fiscal/invoice-records/:id', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid invoice record id' });
  }

  const record = await InvoiceRecord.findById(id).lean();
  if (!record) return res.status(404).json({ error: 'Not found' });

  res.json(record);
});

router.get('/fiscal/transactions', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const { page, limit } = parsePagination(req.query);
  const filter: Record<string, unknown> = {};

  if (status && transactionStatuses.includes(status as TransactionStatus)) {
    filter.status = status;
  }

  for (const key of ['buyerId', 'sellerId', 'auctionResultId']) {
    if (!addObjectIdFilter(filter, key, req.query[key])) {
      return res.status(400).json({ error: `Invalid ${key}` });
    }
  }

  const transactions = await Transaction.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate({ path: 'buyerId', select: 'name' })
    .populate({ path: 'sellerId', select: 'name' })
    .populate({ path: 'auctionResultId', select: '_id auctionId finalPrice status closedAt' })
    .lean();

  const transactionIds = transactions.map((transaction: any) => transaction._id);
  const [snapshots, drafts] = await Promise.all([
    FiscalSnapshot.find({ transactionId: { $in: transactionIds } }).lean(),
    InvoiceDraft.find({ transactionId: { $in: transactionIds } }).lean(),
  ]);
  const snapshotsByTransaction = new Map(snapshots.map((snapshot: any) => [String(snapshot.transactionId), snapshot]));
  const draftsByTransaction = new Map(drafts.map((draft: any) => [String(draft.transactionId), draft]));

  res.json({
    page,
    limit,
    items: transactions.map((transaction: any) => ({
      transaction,
      fiscalSnapshot: snapshotsByTransaction.get(String(transaction._id)) || null,
      invoiceDraft: draftsByTransaction.get(String(transaction._id)) || null,
    })),
  });
});

router.get('/fiscal/transactions/:id/readiness', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const exists = await Transaction.exists({ _id: id });
  if (!exists) return res.status(404).json({ error: 'Not found' });

  const readiness = await evaluateFiscalReadiness(id);

  res.json({
    transactionId: id,
    readiness,
  });
});

router.get('/fiscal/transactions/:id/history', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const transaction = await Transaction.findById(id).lean();
  if (!transaction) return res.status(404).json({ error: 'Not found' });

  const [
    fiscalSnapshot,
    invoiceDraft,
    invoiceQueues,
    invoiceRecords,
    auditEvents,
  ] = await Promise.all([
    FiscalSnapshot.findOne({ transactionId: transaction._id }).lean(),
    InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
    InvoiceQueue.find({ transactionId: transaction._id }).sort({ createdAt: 1 }).lean(),
    InvoiceRecord.find({ transactionId: transaction._id }).sort({ createdAt: 1 }).lean(),
    Audit.find(invoiceAuditFilter({ transactionId: transaction._id })).sort({ createdAt: -1 }).limit(100).lean(),
  ]);

  res.json({
    transaction,
    fiscalSnapshot,
    invoiceDraft,
    invoiceQueues,
    invoiceRecords,
    auditEvents,
  });
});

router.post('/fiscal/transactions/:id/queue', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const transaction = await Transaction.findById(id).lean();
  if (!transaction) return res.status(404).json({ error: 'Not found' });

  const readiness = await evaluateFiscalReadiness(id);
  if (readiness.status !== 'ready') {
    return res.status(409).json({ error: 'Transaction is not ready for invoice queue', readiness });
  }

  const [fiscalSnapshot, invoiceDraft] = await Promise.all([
    FiscalSnapshot.findOne({ transactionId: transaction._id }).lean(),
    InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
  ]);

  if (!fiscalSnapshot || !invoiceDraft) {
    return res.status(409).json({ error: 'Transaction is not ready for invoice queue', readiness });
  }

  const completedQueue = await InvoiceQueue.exists({
    transactionId: transaction._id,
    status: 'completed',
  });
  if (completedQueue) {
    return res.status(409).json({ error: 'Transaction already has a completed invoice queue' });
  }

  const issuedRecord = await InvoiceRecord.exists({
    transactionId: transaction._id,
    lifecycleStatus: 'issued',
  });
  if (issuedRecord) {
    return res.status(409).json({ error: 'Transaction already has an issued invoice record' });
  }

  const queue = await InvoiceQueue.findOneAndUpdate(
    {
      transactionId: transaction._id,
      status: { $in: ['queued', 'processing'] },
    },
    {
      $setOnInsert: {
        transactionId: transaction._id,
        invoiceDraftId: invoiceDraft._id,
        fiscalSnapshotId: fiscalSnapshot._id,
        status: 'queued',
        queuedAt: new Date(),
      },
    },
    { new: true, upsert: true, runValidators: true }
  );

  res.json(queue);
});

router.post('/fiscal/transactions/:id/recover', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const exists = await Transaction.exists({ _id: id });
  if (!exists) return res.status(404).json({ error: 'Not found' });

  const recovery = await recoverFiscalTransaction(id);

  res.status(recovery.recovered ? 200 : 409).json({
    transactionId: id,
    recovery,
  });
});

router.get('/fiscal/transactions/:id', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid transaction id' });
  }

  const transaction = await Transaction.findById(id)
    .populate({ path: 'buyerId', select: 'name' })
    .populate({ path: 'sellerId', select: 'name' })
    .lean();

  if (!transaction) return res.status(404).json({ error: 'Not found' });

  const [fiscalSnapshot, invoiceDraft, auctionResult] = await Promise.all([
    FiscalSnapshot.findOne({ transactionId: transaction._id }).lean(),
    InvoiceDraft.findOne({ transactionId: transaction._id }).lean(),
    AuctionResult.findById(transaction.auctionResultId)
      .select('_id auctionId listingId buyerId sellerId finalPrice status closedAt')
      .populate({ path: 'auctionId', select: '_id title state' })
      .populate({
        path: 'listingId',
        select: '_id animal',
        populate: {
          path: 'animal',
          select: '_id name tag breed',
          populate: { path: 'breed', select: '_id name code' },
        },
      })
      .lean(),
  ]);

  res.json({
    transaction,
    fiscalSnapshot,
    invoiceDraft,
    auctionResult,
  });
});

router.get('/operations', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const { page, limit } = parsePagination(req.query);
  const filter: Record<string, unknown> = {};

  if (status && resultStatuses.includes(status as AuctionResultStatus)) {
    filter.status = status;
  }

  const items = await AuctionResult.find(filter)
    .sort({ closedAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate({ path: 'auctionId', select: '_id title state' })
    .populate({
      path: 'listingId',
      select: '_id animal',
      populate: {
        path: 'animal',
        select: '_id name tag breed',
        populate: { path: 'breed', select: '_id name code' },
      },
    })
    .populate({ path: 'sellerId', select: 'name' })
    .populate({ path: 'buyerId', select: 'name' })
    .lean();

  res.json({
    page,
    limit,
    items: items.map((item: any) => ({
      _id: String(item._id),
      auctionId: item.auctionId,
      animal: item.listingId?.animal || null,
      seller: item.sellerId || null,
      buyer: item.buyerId || null,
      finalPrice: item.finalPrice,
      status: item.status,
      closedAt: item.closedAt,
    })),
  });
});

export default router;
