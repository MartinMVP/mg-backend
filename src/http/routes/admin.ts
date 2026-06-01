import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { AuctionResultStatus, AuctionResult } from '../../domain/auctionResults/auctionResult.model';

const router = Router();
const resultStatuses: AuctionResultStatus[] = [
  'pending_contact',
  'contacted',
  'sale_confirmed',
  'sale_cancelled',
  'in_dispute',
];

// Solo admin y super
router.get('/ping', requireAuth, requireRole('admin', 'super'), (_req, res) => {
  res.json({ ok: true, area: 'admin', ts: new Date().toISOString() });
});

router.get('/operations', requireAuth, requireRole('admin', 'super'), async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
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
