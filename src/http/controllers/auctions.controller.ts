import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Auction } from '../../domain/auctions/auction.model';
import { Bid } from '../../domain/auctions/bid.model';
import { Audit } from '../../domain/audit/audit.model';

function asNum(v: any, def: number) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
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
  const items = await Auction.find().sort({ startsAt: 1 }).populate({
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

export async function openAuction(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await Auction.findOneAndUpdate(
    { _id: req.params.id, state: 'scheduled' },
    { state: 'live' },
    { new: true }
  );
  if (!doc) return res.status(409).json({ error: 'Invalid state' });
  await Audit.create({ actor: user?.sub, action: 'AUCTION_STATE', entity: 'Auction', entityId: doc._id, payload: { to: 'live' } });
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
  await Audit.create({ actor: user?.sub, action: 'AUCTION_STATE', entity: 'Auction', entityId: doc._id, payload: { to: 'paused' } });
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
  await Audit.create({ actor: user?.sub, action: 'AUCTION_STATE', entity: 'Auction', entityId: doc._id, payload: { to: 'live' } });
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
  await Audit.create({ actor: user?.sub, action: 'AUCTION_STATE', entity: 'Auction', entityId: doc._id, payload: { to: 'closed' } });
  res.json(doc);
}

// ---------- Fallback HTTP para pujar ----------
export async function placeBidHttp(req: Request, res: Response) {
  const user = (req as any).user;
  const amount = Number(req.body?.amount || 0);
  const _id = new Types.ObjectId(req.params.id);
  const now = new Date();

  const a = await Auction.findOne({ _id, state: 'live', endsAt: { $gt: now } });
  if (!a) return res.status(409).json({ error: 'Auction not live' });

  const min = a.currentPrice + a.minIncrement;
  if (amount < min) {
    await Audit.create({ actor: user?.sub, action: 'BID_REJECTED', entity: 'Auction', entityId: a._id, payload: { reason: 'low', amount } });
    return res.status(400).json({ error: 'Bid too low', min });
  }

  // atómico: asegurar no hubo carrera
  const next = await Auction.findOneAndUpdate(
    { _id, state: 'live', currentPrice: a.currentPrice, endsAt: { $gt: now } },
    { $set: { currentPrice: amount, currentWinner: user.sub } },
    { new: true }
  );
  if (!next) return res.status(409).json({ error: 'Race condition, try again' });

  // anti-sniping
  const secs = Math.floor((next.endsAt.getTime() - now.getTime()) / 1000);
  if (secs <= next.antiSnipingSec && next.antiSnipingCount < next.antiSnipingMaxExt) {
    next.endsAt = new Date(next.endsAt.getTime() + next.antiSnipingExtendSec * 1000);
    next.antiSnipingCount += 1;
    await next.save();
  }

  await Bid.create({ auction: next._id, listing: next.listing, bidder: user.sub, amount });
  await Audit.create({ actor: user?.sub, action: 'BID_ACCEPTED', entity: 'Auction', entityId: next._id, payload: { amount } });

  res.json(next);
}
