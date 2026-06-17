import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { AuctionListing } from '../auctionListings/auctionListing.model';
import { Conversation } from '../messaging/conversation.model';
import { sendSystemMessage } from '../messaging/messaging.service';
import {
  AuctionCloseOutcome,
  AuctionCloseOutcomeType,
  auctionCloseOutcomes,
} from './auctionCloseOutcome.model';

export const auctionCloseOutcomeAuditActions = {
  recorded: 'AUCTION_CLOSE_OUTCOME_RECORDED',
  completedConfirmed: 'AUCTION_COMPLETED_CONFIRMED',
  notCompletedRecorded: 'AUCTION_NOT_COMPLETED_RECORDED',
  sellerUnresponsiveReported: 'AUCTION_SELLER_UNRESPONSIVE_REPORTED',
} as const;

const defaultLimit = 20;
const maxLimit = 100;

type PaginationInput = {
  page?: unknown;
  limit?: unknown;
};

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

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

function assertOutcome(value: unknown): AuctionCloseOutcomeType {
  if (!auctionCloseOutcomes.includes(value as AuctionCloseOutcomeType)) reject(400, 'invalid_close_outcome');
  return value as AuctionCloseOutcomeType;
}

async function audit(actor: string, action: string, auctionListingId: Types.ObjectId, payload?: Record<string, unknown>) {
  await Audit.create({
    actor,
    action,
    entity: 'AuctionCloseOutcome',
    entityId: auctionListingId,
    payload,
  });
}

async function sendOutcomeSystemMessage(input: {
  auctionListingId: Types.ObjectId;
  actorId: Types.ObjectId;
  outcome: AuctionCloseOutcomeType;
}) {
  const conversation = await Conversation.findOne({
    type: 'auction',
    auctionListingId: input.auctionListingId,
    status: { $ne: 'deleted' },
  }).sort({ createdAt: -1 });

  if (!conversation) return;

  const bodyByOutcome: Record<AuctionCloseOutcomeType, string> = {
    completed: 'El vendedor confirmo que la Auction Listing fue completada.',
    not_completed: 'El vendedor registro que la Auction Listing no fue completada.',
    seller_unresponsive: 'El ganador reporto que el vendedor no responde para cerrar la Auction Listing.',
  };

  await sendSystemMessage({
    conversationId: conversation._id,
    actorId: input.actorId,
    source: 'auction',
    body: bodyByOutcome[input.outcome],
    eventKey: `auction-close-outcome:${input.auctionListingId}`,
    metadata: {
      auctionListingId: String(input.auctionListingId),
      outcome: input.outcome,
    },
  });
}

async function assertAuctionConversationExists(auctionListingId: Types.ObjectId) {
  const conversation = await Conversation.findOne({
    type: 'auction',
    auctionListingId,
    status: { $ne: 'deleted' },
  }).select('_id').lean();

  if (!conversation) reject(409, 'auction_conversation_required');
}

async function createOutcome(input: {
  auctionListingId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  outcome: AuctionCloseOutcomeType;
}) {
  const auctionListingId = toObjectId(input.auctionListingId);
  const actorId = toObjectId(input.actorId);
  const existing = await AuctionCloseOutcome.exists({ auctionListingId });
  if (existing) reject(409, 'auction_close_outcome_already_exists');

  const auctionListing = await AuctionListing.findById(auctionListingId);
  if (!auctionListing) reject(404, 'auction_listing_not_found');
  if (auctionListing.status !== 'closed') reject(409, 'auction_listing_not_closed');
  if (!auctionListing.winnerUserId) reject(409, 'auction_listing_has_no_winner');

  if (input.outcome === 'seller_unresponsive') {
    if (String(auctionListing.winnerUserId) !== String(actorId)) reject(403, 'forbidden');
    await assertAuctionConversationExists(auctionListingId);
  } else if (String(auctionListing.sellerId) !== String(actorId)) {
    reject(403, 'forbidden');
  }

  try {
    const outcome = await AuctionCloseOutcome.create({
      auctionListingId,
      listingId: auctionListing.listingId,
      sellerId: auctionListing.sellerId,
      winnerUserId: auctionListing.winnerUserId,
      outcome: input.outcome,
      recordedBy: actorId,
    });

    await sendOutcomeSystemMessage({ auctionListingId, actorId, outcome: input.outcome });
    await audit(String(actorId), auctionCloseOutcomeAuditActions.recorded, auctionListingId, {
      outcome: input.outcome,
      closeOutcomeId: String(outcome._id),
    });

    const actionByOutcome: Record<AuctionCloseOutcomeType, string> = {
      completed: auctionCloseOutcomeAuditActions.completedConfirmed,
      not_completed: auctionCloseOutcomeAuditActions.notCompletedRecorded,
      seller_unresponsive: auctionCloseOutcomeAuditActions.sellerUnresponsiveReported,
    };
    await audit(String(actorId), actionByOutcome[input.outcome], auctionListingId, {
      closeOutcomeId: String(outcome._id),
    });

    return outcome;
  } catch (error) {
    if ((error as any)?.code === 11000) reject(409, 'auction_close_outcome_already_exists');
    throw error;
  }
}

export async function recordAuctionCloseOutcome(input: {
  auctionListingId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  outcome: unknown;
}) {
  const outcome = assertOutcome(input.outcome);
  if (outcome === 'seller_unresponsive') reject(400, 'invalid_close_outcome_for_seller');
  return createOutcome({ ...input, outcome });
}

export async function reportSellerUnresponsive(input: {
  auctionListingId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  return createOutcome({
    auctionListingId: input.auctionListingId,
    actorId: input.actorId,
    outcome: 'seller_unresponsive',
  });
}

export async function listAuctionCloseOutcomes(filters: PaginationInput & {
  outcome?: AuctionCloseOutcomeType;
  auctionListingId?: string;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.outcome) query.outcome = assertOutcome(filters.outcome);
  if (filters.auctionListingId) query.auctionListingId = toObjectId(filters.auctionListingId);

  const [total, outcomes] = await Promise.all([
    AuctionCloseOutcome.countDocuments(query),
    AuctionCloseOutcome.find(query)
      .sort({ createdAt: -1 })
      .skip(pagination.skip)
      .limit(pagination.limit)
      .lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, outcomes };
}

export async function getAuctionCloseOutcome(id: string | Types.ObjectId) {
  const outcome = await AuctionCloseOutcome.findById(toObjectId(id)).lean();
  if (!outcome) reject(404, 'auction_close_outcome_not_found');
  return outcome;
}
