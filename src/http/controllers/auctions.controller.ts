import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Auction } from '../../domain/auctions/auction.model';
import { Bid } from '../../domain/auctions/bid.model';
import { Audit } from '../../domain/audit/audit.model';
import { emitAuctionStateChanged } from '../../realtime/socket';

function asNum(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function parseBidAmount(v: any) {
  const amount = Number(v);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

// ---------- CRUD/acciones ----------
export async function createAuction(req: Request, res: Response) {
  const { listing, startsAt, endsAt, title, startPrice, minIncrement } = req.body;

  if (!listing || !startsAt || !endsAt || !title) {
    return res.status(400).json({ error: 'Campos requeridos' });
  }

  const doc = await Auction.create({
    title,
    listing,
    startsAt,
    endsAt,
    startPrice: asNum(startPrice, 0),
    minIncrement: Math.max(1, asNum(minIncrement, 100)),
    currentPrice: asNum(startPrice, 0),
  });

  res.status(201).json(doc);
}

export async function listAuctions(_req: Request, res: Response) {
  const items = await Auction.find()
    .sort({ startsAt: 1 })
    .populate({
      path: 'listing',
      populate: { path: 'animal', populate: ['breed', 'registry'] },
    });

  res.json(items);
}

export async function getAuction(req: Request, res: Response) {
  const doc = await Auction.findById(req.params.id).populate({
    path: 'listing',
    populate: { path: 'animal', populate: ['breed', 'registry'] },
  });

  if (!doc) return res.status(404).json({ error: 'Not found' });

  res.json(doc);
}

export async function getAuctionBids(req: Request, res: Response) {
  const id = String(req.params.id);

  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }

  const bids = await Bid.find({ auction: id })
    .sort({ createdAt: -1 })
    .limit(20)
    .populate('bidder', 'name email role')
    .lean();

  res.json(bids);
}

export async function openAuction(req: Request, res: Response) {
  const user = (req as any).user;

  const doc = await Auction.findOneAndUpdate(
    { _id: req.params.id, state: 'scheduled' },
    { state: 'live' },
    { new: true }
  );

  if (!doc) return res.status(409).json({ error: 'Invalid state' });

  await Audit.create({
    actor: user?.sub,
    action: 'AUCTION_STATE',
    entity: 'Auction',
    entityId: doc._id,
    payload: { to: 'live' },
  });

  res.json(doc);
}

export async function pauseAuction(req: Request, res: Response) {
  const user = (req as any).user;

  const doc = await Auction.findOneAndUpdate(
    { _id: req.params.id, state: 'live' },
    { state: 'paused' },
    { new: true }
  );

  if (!doc) return res.status(409).json({ error: 'Invalid state' });

  await Audit.create({
    actor: user?.sub,
    action: 'AUCTION_STATE',
    entity: 'Auction',
    entityId: doc._id,
    payload: { to: 'paused' },
  });

  res.json(doc);
}

export async function resumeAuction(req: Request, res: Response) {
  const user = (req as any).user;

  const doc = await Auction.findOneAndUpdate(
    { _id: req.params.id, state: 'paused' },
    { state: 'live' },
    { new: true }
  );

  if (!doc) return res.status(409).json({ error: 'Invalid state' });

  await Audit.create({
    actor: user?.sub,
    action: 'AUCTION_STATE',
    entity: 'Auction',
    entityId: doc._id,
    payload: { to: 'live' },
  });

  res.json(doc);
}

export async function closeAuction(req: Request, res: Response) {
  const user = (req as any).user;

  const doc = await Auction.findOneAndUpdate(
    { _id: req.params.id, state: { $in: ['live', 'paused'] } },
    { state: 'closed' },
    { new: true }
  );

  if (!doc) return res.status(409).json({ error: 'Invalid state' });

  await Audit.create({
    actor: user?.sub,
    action: 'AUCTION_STATE',
    entity: 'Auction',
    entityId: doc._id,
    payload: { to: 'closed' },
  });

  res.json(doc);
}

// ---------- Fallback HTTP para pujar ----------
export async function placeBidHttp(req: Request, res: Response) {
  const user = (req as any).user;
  const amount = parseBidAmount(req.body?.amount);
  const id = String(req.params.id);
  if (!Types.ObjectId.isValid(id)) {
    return res.status(400).json({ error: 'Invalid auction id' });
  }
  if (amount === null) {
    return res.status(400).json({ error: 'Invalid bid amount' });
  }
  const _id = new Types.ObjectId(id);
  const now = new Date();

  const a = await Auction.findOne({
    _id,
    state: 'live',
    endsAt: { $gt: now },
  });

  if (!a) return res.status(409).json({ error: 'Auction not live' });

  const min = a.currentPrice + a.minIncrement;

  if (amount < min) {
    await Audit.create({
      actor: user?.sub,
      action: 'BID_REJECTED',
      entity: 'Auction',
      entityId: a._id,
      payload: { reason: 'low', amount },
    });

    return res.status(400).json({ error: 'Bid too low', min });
  }

  const secs = Math.floor((a.endsAt.getTime() - now.getTime()) / 1000);
  const shouldExtend =
    secs <= a.antiSnipingSec && a.antiSnipingCount < a.antiSnipingMaxExt;
  const extendedEndsAt = shouldExtend
    ? new Date(a.endsAt.getTime() + a.antiSnipingExtendSec * 1000)
    : null;
  const bidNow = new Date();

  const bidFilter: any = {
    _id,
    state: 'live',
    currentPrice: a.currentPrice,
  };

  const bidUpdate: any = {
    $set: {
      currentPrice: amount,
      currentWinner: user.sub,
    },
  };

  if (shouldExtend && extendedEndsAt) {
    bidFilter.endsAt = { $eq: a.endsAt, $gt: bidNow };
    bidFilter.antiSnipingCount = a.antiSnipingCount;
    bidUpdate.$set.endsAt = extendedEndsAt;
    bidUpdate.$inc = { antiSnipingCount: 1 };
  } else {
    bidFilter.endsAt = { $gt: bidNow };
  }

  // atómico: asegurar no hubo carrera y extender anti-sniping si aplica
  const next = await Auction.findOneAndUpdate(
    bidFilter,
    bidUpdate,
    { new: true }
  );

  if (!next) return res.status(409).json({ error: 'Race condition, try again' });

  const bid = await Bid.create({
    auction: next._id,
    listing: next.listing,
    bidder: user.sub,
    amount,
  });

  if (shouldExtend && extendedEndsAt) {
    emitAuctionStateChanged(String(next._id), {
      auctionId: String(next._id),
      state: next.state,
      endsAt: next.endsAt.toISOString(),
    });
  }

  await Audit.create({
    actor: user?.sub,
    action: 'BID_ACCEPTED',
    entity: 'Auction',
    entityId: next._id,
    payload: { amount },
  });

  res.json({
    ...next.toObject(),
    lastBid: {
      _id: bid._id,
      auction: bid.auction,
      listing: bid.listing,
      bidder: bid.bidder,
      amount: bid.amount,
      createdAt: (bid as any).createdAt,
    },
  });
}
