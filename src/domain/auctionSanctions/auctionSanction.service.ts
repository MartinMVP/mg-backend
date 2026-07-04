import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { AuctionDefaultReport } from '../auctionDefaults/auctionDefault.model';
import { countConfirmedDefaultsForUser } from '../auctionDefaults/auctionDefault.repository';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AuctionSanction, AuctionSanctionType } from './auctionSanction.model';

export const auctionSanctionAuditActions = {
  applied: 'AUCTION_SANCTION_APPLIED',
  revoked: 'AUCTION_SANCTION_REVOKED',
  expired: 'AUCTION_SANCTION_EXPIRED',
} as const;

export type AuctionSanctionRecommendation = {
  offenseNumber: number;
  recommendedAction: 'temporary_suspension' | 'permanent_suspension' | 'manual_review';
  recommendedDurationDays?: number;
  reason: string;
  sourceDefaultId: string;
};

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

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

async function getSanctionPolicy() {
  const [
    firstOffenseDays,
    secondOffenseDays,
    thirdOffensePolicy,
    permanentThreshold,
  ] = await Promise.all([
    getConfigValue('auction.sanctions.firstOffenseDays', 'sandbox', 30),
    getConfigValue('auction.sanctions.secondOffenseDays', 'sandbox', 180),
    getConfigValue('auction.sanctions.thirdOffensePolicy', 'sandbox', 'permanent'),
    getConfigValue('auction.sanctions.permanentThreshold', 'sandbox', 3),
  ]);

  const normalizedThirdPolicy = ['permanent', 'manual_review', 'extended_days'].includes(String(thirdOffensePolicy))
    ? String(thirdOffensePolicy)
    : 'permanent';

  return {
    firstOffenseDays: Number(firstOffenseDays) > 0 ? Number(firstOffenseDays) : 30,
    secondOffenseDays: Number(secondOffenseDays) > 0 ? Number(secondOffenseDays) : 180,
    thirdOffensePolicy: normalizedThirdPolicy as 'permanent' | 'manual_review' | 'extended_days',
    permanentThreshold: Number(permanentThreshold) > 0 ? Number(permanentThreshold) : 3,
  };
}

export async function buildAuctionSanctionRecommendation(sourceDefaultId: string | Types.ObjectId) {
  const sourceDefaultObjectId = toObjectId(sourceDefaultId);
  const sourceDefault = await AuctionDefaultReport.findById(sourceDefaultObjectId).lean();
  if (!sourceDefault) reject(404, 'auction_default_not_found');
  if (sourceDefault.status !== 'confirmed') reject(409, 'auction_default_not_confirmed');

  const [policy, confirmedDefaults] = await Promise.all([
    getSanctionPolicy(),
    countConfirmedDefaultsForUser(sourceDefault.reportedUserId),
  ]);
  const offenseNumber = Math.max(confirmedDefaults, 1);

  let recommendedAction: AuctionSanctionRecommendation['recommendedAction'] = 'temporary_suspension';
  let recommendedDurationDays: number | undefined = policy.firstOffenseDays;
  if (offenseNumber >= policy.permanentThreshold) {
    if (policy.thirdOffensePolicy === 'manual_review') {
      recommendedAction = 'manual_review';
      recommendedDurationDays = undefined;
    } else if (policy.thirdOffensePolicy === 'extended_days') {
      recommendedDurationDays = policy.secondOffenseDays * 2;
    } else {
      recommendedAction = 'permanent_suspension';
      recommendedDurationDays = undefined;
    }
  } else if (offenseNumber === 2) {
    recommendedDurationDays = policy.secondOffenseDays;
  }

  return {
    offenseNumber,
    recommendedAction,
    recommendedDurationDays,
    reason: `${sourceDefault.role}_default_confirmed`,
    sourceDefaultId: String(sourceDefault._id),
  };
}

export async function applyAuctionSanction(input: {
  actorId: string | Types.ObjectId;
  recommendation: AuctionSanctionRecommendation;
}) {
  const actorId = toObjectId(input.actorId);
  const sourceDefaultId = toObjectId(input.recommendation?.sourceDefaultId);
  const rebuilt = await buildAuctionSanctionRecommendation(sourceDefaultId);
  if (
    rebuilt.offenseNumber !== input.recommendation.offenseNumber
    || rebuilt.recommendedAction !== input.recommendation.recommendedAction
    || rebuilt.recommendedDurationDays !== input.recommendation.recommendedDurationDays
  ) {
    reject(409, 'auction_sanction_recommendation_stale');
  }
  if (rebuilt.recommendedAction === 'manual_review') reject(409, 'auction_sanction_manual_review_required');

  const sourceDefault = await AuctionDefaultReport.findById(sourceDefaultId).lean();
  if (!sourceDefault || sourceDefault.status !== 'confirmed') reject(409, 'auction_default_not_confirmed');

  const existing = await AuctionSanction.exists({ sourceDefaultId, status: { $in: ['active', 'expired'] } });
  if (existing) reject(409, 'auction_sanction_already_exists');

  const startsAt = new Date();
  const endsAt = rebuilt.recommendedDurationDays
    ? new Date(startsAt.getTime() + rebuilt.recommendedDurationDays * 24 * 60 * 60_000)
    : undefined;

  try {
    const sanction = await AuctionSanction.create({
      userId: sourceDefault.reportedUserId,
      type: sourceDefault.role as AuctionSanctionType,
      sourceDefaultId,
      offenseNumber: rebuilt.offenseNumber,
      reason: rebuilt.reason,
      status: 'active',
      startsAt,
      endsAt,
      createdBy: actorId,
    });
    await audit(String(actorId), auctionSanctionAuditActions.applied, {
      auctionSanctionId: String(sanction._id),
      sourceDefaultId: String(sourceDefaultId),
      userId: String(sourceDefault.reportedUserId),
      type: sourceDefault.role,
    });
    return sanction;
  } catch (error) {
    if ((error as any)?.code === 11000) reject(409, 'auction_sanction_already_exists');
    throw error;
  }
}

export async function listAuctionSanctions(filters: PaginationInput & {
  status?: string;
  userId?: string;
  type?: AuctionSanctionType;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.userId) query.userId = toObjectId(filters.userId);
  if (filters.type) query.type = filters.type;

  const [total, sanctions] = await Promise.all([
    AuctionSanction.countDocuments(query),
    AuctionSanction.find(query).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, sanctions };
}

export async function getAuctionSanction(id: string | Types.ObjectId) {
  const sanction = await AuctionSanction.findById(toObjectId(id)).lean();
  if (!sanction) reject(404, 'auction_sanction_not_found');
  return sanction;
}

export async function revokeAuctionSanction(input: {
  sanctionId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
}) {
  const sanctionId = toObjectId(input.sanctionId);
  const actorId = toObjectId(input.actorId);
  const sanction = await AuctionSanction.findById(sanctionId);
  if (!sanction) reject(404, 'auction_sanction_not_found');
  if (sanction.status !== 'active') reject(409, 'auction_sanction_not_active');
  sanction.status = 'revoked';
  sanction.revokedBy = actorId;
  sanction.revokedAt = new Date();
  await sanction.save();
  await audit(String(actorId), auctionSanctionAuditActions.revoked, {
    auctionSanctionId: String(sanction._id),
    userId: String(sanction.userId),
    type: sanction.type,
  });
  return sanction;
}
