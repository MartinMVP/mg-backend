import { Types } from 'mongoose';
import { AuctionSanction, AuctionSanctionType } from './auctionSanction.model';

function toObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw new Error('invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

async function expireElapsedSanctions(userId?: Types.ObjectId, type?: AuctionSanctionType) {
  const now = new Date();
  const query: Record<string, unknown> = {
    status: 'active',
    endsAt: { $lte: now },
  };
  if (userId) query.userId = userId;
  if (type) query.type = type;
  await AuctionSanction.updateMany(query, { $set: { status: 'expired' } });
}

export async function getActiveAuctionSanction(userId: string | Types.ObjectId, type: AuctionSanctionType) {
  const userObjectId = toObjectId(userId);
  await expireElapsedSanctions(userObjectId, type);
  return AuctionSanction.findOne({
    userId: userObjectId,
    type,
    status: 'active',
    $or: [{ endsAt: { $exists: false } }, { endsAt: null }, { endsAt: { $gt: new Date() } }],
  }).sort({ createdAt: -1 }).lean();
}

export async function canParticipateInAuction(userId: string | Types.ObjectId) {
  const sanction = await getActiveAuctionSanction(userId, 'buyer');
  if (!sanction) return { allowed: true };
  return { allowed: false, reason: 'AUCTION_BUYER_SANCTION_ACTIVE', sanction };
}

export async function canCreateAuctionListing(userId: string | Types.ObjectId) {
  const sanction = await getActiveAuctionSanction(userId, 'seller');
  if (!sanction) return { allowed: true };
  return { allowed: false, reason: 'AUCTION_SELLER_SANCTION_ACTIVE', sanction };
}
