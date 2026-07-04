import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { Animal } from '../animals/animal.model';
import { Listing } from '../listings/listing.model';
import { getUserMembership } from '../memberships/membership.service';
import { createConversation, sendSystemMessage } from '../messaging/messaging.service';
import { canCreateAuctionListing, canParticipateInAuction } from '../auctionSanctions/auctionEligibility.service';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AuctionBid } from './auctionBid.model';
import { AuctionListing, AuctionListingStatus } from './auctionListing.model';

export const auctionListingAuditActions = {
  created: 'AUCTION_LISTING_CREATED',
  published: 'AUCTION_LISTING_PUBLISHED',
  bidPlaced: 'AUCTION_BID_PLACED',
  bidRejected: 'AUCTION_BID_REJECTED',
  extended: 'AUCTION_EXTENDED',
  closed: 'AUCTION_CLOSED',
  winnerSelected: 'AUCTION_WINNER_SELECTED',
  winnerConversationCreated: 'AUCTION_WINNER_CONVERSATION_CREATED',
} as const;

const minDurationDays = 5;
const defaultDurationDays = 7;
const maxDurationDays = 10;
const antiSnipingExtensionMinutes = 5;
const maxExtensions = 3;
const incrementTier1 = 500;
const incrementTier2 = 1_000;
const incrementTier3 = 2_500;
const defaultLimit = 20;
const maxLimit = 100;

type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

type CloseOptions = {
  actorId?: string | Types.ObjectId;
  manual?: boolean;
  now?: Date;
};

function toObjectId(id: string | Types.ObjectId) {
  if (!Types.ObjectId.isValid(String(id))) throw new Error('invalid_object_id');
  return typeof id === 'string' ? new Types.ObjectId(id) : id;
}

function normalizePagination(input: PaginationInput = {}) {
  const parsedPage = Number(input.page);
  const parsedLimit = Number(input.limit);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

async function getAuctionConfiguration() {
  const [
    configuredMinDurationDays,
    configuredMaxDurationDays,
    configuredDefaultDurationDays,
    configuredSnipingExtensionMinutes,
    configuredMaxExtensions,
    configuredIncrementTier1,
    configuredIncrementTier2,
    configuredIncrementTier3,
  ] = await Promise.all([
    getConfigValue('auction.minDurationDays', 'sandbox', minDurationDays),
    getConfigValue('auction.maxDurationDays', 'sandbox', maxDurationDays),
    getConfigValue('auction.defaultDurationDays', 'sandbox', defaultDurationDays),
    getConfigValue('auction.snipingExtensionMinutes', 'sandbox', antiSnipingExtensionMinutes),
    getConfigValue('auction.maxExtensions', 'sandbox', maxExtensions),
    getConfigValue('auction.incrementTier1', 'sandbox', incrementTier1),
    getConfigValue('auction.incrementTier2', 'sandbox', incrementTier2),
    getConfigValue('auction.incrementTier3', 'sandbox', incrementTier3),
  ]);

  return {
    minDurationDays: Number(configuredMinDurationDays),
    maxDurationDays: Number(configuredMaxDurationDays),
    defaultDurationDays: Number(configuredDefaultDurationDays),
    antiSnipingExtensionMinutes: Number(configuredSnipingExtensionMinutes),
    maxExtensions: Number(configuredMaxExtensions),
    incrementTier1: Number(configuredIncrementTier1),
    incrementTier2: Number(configuredIncrementTier2),
    incrementTier3: Number(configuredIncrementTier3),
  };
}

function safePositiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function normalizeDurationDays(durationDays: unknown) {
  const config = await getAuctionConfiguration();
  const safeDefault = safePositiveNumber(config.defaultDurationDays, defaultDurationDays);
  const safeMin = safePositiveNumber(config.minDurationDays, minDurationDays);
  const safeMax = Math.max(safeMin, safePositiveNumber(config.maxDurationDays, maxDurationDays));
  const parsed = Number(durationDays ?? safeDefault);
  if (!Number.isFinite(parsed)) return safeDefault;
  return Math.min(Math.max(Math.floor(parsed), safeMin), safeMax);
}

export async function getMinimumBidIncrement(amount: number) {
  const config = await getAuctionConfiguration();
  if (amount <= 50_000) return safePositiveNumber(config.incrementTier1, incrementTier1);
  if (amount <= 150_000) return safePositiveNumber(config.incrementTier2, incrementTier2);
  return safePositiveNumber(config.incrementTier3, incrementTier3);
}

async function audit(actor: string, action: string, auctionListingId: Types.ObjectId, payload?: Record<string, unknown>) {
  await Audit.create({
    actor,
    action,
    entity: 'AuctionListing',
    entityId: auctionListingId,
    payload,
  });
}

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

async function assertBusinessMembership(userId: string | Types.ObjectId) {
  const { membership, plan } = await getUserMembership(userId);
  if (!membership || membership.status !== 'active') reject(403, 'active_membership_required');
  if (plan?.code !== 'business') reject(403, 'business_membership_required');
}

async function rejectBid(input: {
  actorId: Types.ObjectId;
  auctionListingId?: Types.ObjectId;
  amount: number;
  reason: string;
}) {
  if (input.auctionListingId) {
    await audit(String(input.actorId), auctionListingAuditActions.bidRejected, input.auctionListingId, {
      amount: input.amount,
      reason: input.reason,
    });
  }
  reject(400, input.reason);
}

export async function createAuctionListing(input: {
  actorId: string | Types.ObjectId;
  listingId: string | Types.ObjectId;
  startingPrice: unknown;
  durationDays?: unknown;
}) {
  await assertBusinessMembership(input.actorId);
  const sellerEligibility = await canCreateAuctionListing(input.actorId);
  if (!sellerEligibility.allowed) reject(403, sellerEligibility.reason || 'AUCTION_SELLER_SANCTION_ACTIVE');
  const actorId = toObjectId(input.actorId);
  const listingId = toObjectId(input.listingId);
  const startingPrice = Number(input.startingPrice);
  if (!Number.isFinite(startingPrice) || startingPrice <= 0) reject(400, 'starting_price_must_be_positive');

  const listing = await Listing.findById(listingId);
  if (!listing) reject(404, 'listing_not_found');
  if (String(listing.seller) !== String(actorId)) reject(403, 'listing_not_owned');
  if (listing.status !== 'published') reject(409, 'listing_not_eligible');

  const animal = await Animal.findById(listing.animal).select('owner deletedAt').lean();
  if (!animal || animal.deletedAt) reject(404, 'animal_not_found');
  const sellerId = toObjectId(animal.owner);
  if (String(sellerId) !== String(actorId)) reject(403, 'listing_not_owned');

  const existing = await AuctionListing.findOne({
    listingId: listing._id,
    status: { $in: ['draft', 'active'] },
  });
  if (existing) reject(409, 'auction_listing_already_exists');

  const now = new Date();
  const durationDays = await normalizeDurationDays(input.durationDays);
  const auctionListing = await AuctionListing.create({
    listingId: listing._id,
    sellerId,
    status: 'active',
    startingPrice,
    currentPrice: startingPrice,
    startsAt: now,
    endsAt: new Date(now.getTime() + durationDays * 24 * 60 * 60_000),
    extensionCount: 0,
  });

  await Listing.updateOne({ _id: listing._id, status: 'published' }, { $set: { status: 'auction_active' } });
  await audit(String(actorId), auctionListingAuditActions.created, auctionListing._id, { listingId: listing._id });
  await audit(String(actorId), auctionListingAuditActions.published, auctionListing._id, { listingId: listing._id });

  return auctionListing;
}

export async function listAuctionListings(filters: PaginationInput & {
  status?: AuctionListingStatus;
  sellerId?: string;
}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.sellerId) query.sellerId = toObjectId(filters.sellerId);

  const [total, auctionListings] = await Promise.all([
    AuctionListing.countDocuments(query),
    AuctionListing.find(query)
      .sort({ endsAt: 1, createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, auctionListings };
}

export async function getAuctionListing(id: string | Types.ObjectId) {
  const auctionListing = await AuctionListing.findById(toObjectId(id)).lean();
  if (!auctionListing) reject(404, 'auction_listing_not_found');
  return auctionListing;
}

export async function placeBid(input: {
  auctionListingId: string | Types.ObjectId;
  bidderId: string | Types.ObjectId;
  amount: unknown;
  now?: Date;
}) {
  const auctionListingId = toObjectId(input.auctionListingId);
  const bidderId = toObjectId(input.bidderId);
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return rejectBid({ actorId: bidderId, auctionListingId, amount, reason: 'bid_amount_must_be_positive' });
  }

  const auctionListing = await AuctionListing.findById(auctionListingId);
  if (!auctionListing) reject(404, 'auction_listing_not_found');
  if (String(auctionListing.sellerId) === String(bidderId)) {
    return rejectBid({ actorId: bidderId, auctionListingId, amount, reason: 'seller_cannot_bid' });
  }
  const buyerEligibility = await canParticipateInAuction(bidderId);
  if (!buyerEligibility.allowed) reject(403, buyerEligibility.reason || 'AUCTION_BUYER_SANCTION_ACTIVE');
  if (auctionListing.status !== 'active') {
    return rejectBid({ actorId: bidderId, auctionListingId, amount, reason: 'auction_listing_not_active' });
  }

  const now = input.now || new Date();
  if (now < auctionListing.startsAt || now > auctionListing.endsAt) {
    return rejectBid({ actorId: bidderId, auctionListingId, amount, reason: 'auction_listing_not_in_bid_window' });
  }

  const latestValidBid = await AuctionBid.findOne({ auctionListingId, status: 'valid' })
    .sort({ amount: -1, createdAt: -1 });
  const minimumAmount = latestValidBid
    ? auctionListing.currentPrice + await getMinimumBidIncrement(auctionListing.currentPrice)
    : auctionListing.startingPrice;
  if (amount < minimumAmount) {
    return rejectBid({ actorId: bidderId, auctionListingId, amount, reason: 'bid_amount_too_low' });
  }

  const bid = await AuctionBid.create({
    auctionListingId,
    bidderId,
    amount,
    status: 'valid',
  });

  const config = await getAuctionConfiguration();
  const extensionMinutes = safePositiveNumber(config.antiSnipingExtensionMinutes, antiSnipingExtensionMinutes);
  const antiSnipingWindowMs = extensionMinutes * 60_000;
  const antiSnipingExtensionMs = extensionMinutes * 60_000;
  const configuredMaxExtensions = Math.max(0, Math.floor(safePositiveNumber(config.maxExtensions, maxExtensions)));
  const set: Record<string, unknown> = { currentPrice: amount };
  const shouldExtend = auctionListing.endsAt.getTime() - now.getTime() <= antiSnipingWindowMs
    && auctionListing.extensionCount < configuredMaxExtensions;
  if (shouldExtend) {
    set.endsAt = new Date(auctionListing.endsAt.getTime() + antiSnipingExtensionMs);
    set.extensionCount = auctionListing.extensionCount + 1;
  }

  const updatedAuctionListing = await AuctionListing.findByIdAndUpdate(
    auctionListingId,
    { $set: set },
    { new: true, runValidators: true }
  );
  await audit(String(bidderId), auctionListingAuditActions.bidPlaced, auctionListingId, { bidId: bid._id, amount });
  if (shouldExtend) {
    await audit(String(bidderId), auctionListingAuditActions.extended, auctionListingId, {
      bidId: bid._id,
      endsAt: updatedAuctionListing?.endsAt,
      extensionCount: updatedAuctionListing?.extensionCount,
    });
  }

  return { bid, auctionListing: updatedAuctionListing };
}

export async function listAuctionBids(
  auctionListingId: string | Types.ObjectId,
  paginationInput: PaginationInput = {}
) {
  const pagination = normalizePagination(paginationInput);
  const query = { auctionListingId: toObjectId(auctionListingId) };
  const [total, bids] = await Promise.all([
    AuctionBid.countDocuments(query),
    AuctionBid.find(query).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, bids };
}

export async function closeAuctionListing(auctionListingId: string | Types.ObjectId, options: CloseOptions = {}) {
  const auctionListingObjectId = toObjectId(auctionListingId);
  const auctionListing = await AuctionListing.findById(auctionListingObjectId);
  if (!auctionListing) reject(404, 'auction_listing_not_found');
  if (auctionListing.status !== 'active') reject(409, 'auction_listing_not_active');

  const now = options.now || new Date();
  const actor = options.actorId ? String(options.actorId) : 'system';
  if (!options.manual && now < auctionListing.endsAt) reject(409, 'auction_listing_not_ended');

  const winningBid = await AuctionBid.findOne({
    auctionListingId: auctionListing._id,
    status: 'valid',
  }).sort({ amount: -1, createdAt: -1 });

  const set: Record<string, unknown> = {
    status: 'closed',
    closedAt: now,
    closedReason: options.manual ? 'admin_closed' : 'ended',
  };
  if (winningBid) {
    set.winnerUserId = winningBid.bidderId;
    set.winningBidId = winningBid._id;
  }

  const closedAuctionListing = await AuctionListing.findByIdAndUpdate(
    auctionListing._id,
    { $set: set },
    { new: true, runValidators: true }
  );

  await Listing.updateOne(
    { _id: auctionListing.listingId, status: 'auction_active' },
    { $set: { status: winningBid ? 'auction_closed' : 'published' } }
  );

  await audit(actor, auctionListingAuditActions.closed, auctionListing._id, { winningBidId: winningBid?._id });

  if (winningBid) {
    await audit(actor, auctionListingAuditActions.winnerSelected, auctionListing._id, {
      winnerUserId: winningBid.bidderId,
      winningBidId: winningBid._id,
    });

    const conversation = await createConversation({
      actorId: auctionListing.sellerId,
      type: 'auction',
      participantIds: [winningBid.bidderId],
      listingId: auctionListing.listingId,
      auctionListingId: auctionListing._id,
    });
    await sendSystemMessage({
      conversationId: conversation._id,
      actorId: auctionListing.sellerId,
      source: 'auction',
      body: 'Has ganado esta Auction Listing. Usa esta conversacion para coordinar el cierre con el vendedor.',
      eventKey: `auction-listing-winner:${auctionListing._id}`,
      metadata: {
        auctionListingId: String(auctionListing._id),
        winningBidId: String(winningBid._id),
      },
    });
    await audit(actor, auctionListingAuditActions.winnerConversationCreated, auctionListing._id, {
      conversationId: conversation._id,
      winnerUserId: winningBid.bidderId,
    });
  }

  return closedAuctionListing;
}
