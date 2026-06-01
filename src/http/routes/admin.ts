import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { AuctionResultStatus, AuctionResult } from '../../domain/auctionResults/auctionResult.model';
import { FiscalSnapshot } from '../../domain/fiscalSnapshots/fiscalSnapshot.model';
import { InvoiceDraft } from '../../domain/invoiceDrafts/invoiceDraft.model';
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

// Solo admin y super
router.get('/ping', requireAuth, requireRole('admin', 'super'), (_req, res) => {
  res.json({ ok: true, area: 'admin', ts: new Date().toISOString() });
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
