import { Types } from 'mongoose';
import { Audit } from '../audit/audit.model';
import { observeAuctionComplianceEvent } from '../aoe/aoeCase.service';
import { AuctionSanction } from '../auctionSanctions/auctionSanction.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AuctionAppeal, AuctionAppealStatus } from './auctionAppeal.model';

export const auctionAppealAuditActions = {
  requested: 'AUCTION_APPEAL_REQUESTED',
  approved: 'AUCTION_APPEAL_APPROVED',
  rejected: 'AUCTION_APPEAL_REJECTED',
  closed: 'AUCTION_APPEAL_CLOSED',
} as const;

const defaultLimit = 20;
const maxLimit = 100;
const activeAppealStatuses = ['requested', 'under_review'];
const sensitiveEvidenceKey = /(secret|token|password|authorization|cookie|payload|raw|api[-_]?key|private[-_]?key)/i;

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

function sanitizeEvidenceValue(value: unknown): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value.slice(0, 1000);
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeEvidenceValue);
  if (typeof value === 'object') return '[object]';
  return undefined;
}

function sanitizeEvidence(evidence: unknown) {
  if (!evidence) return undefined;
  if (typeof evidence !== 'object' || Array.isArray(evidence)) return sanitizeEvidenceValue(evidence);
  const sanitized = Object.entries(evidence as Record<string, unknown>).reduce<Record<string, unknown>>((acc, [key, value]) => {
    if (!key || sensitiveEvidenceKey.test(key)) return acc;
    const sanitizedValue = sanitizeEvidenceValue(value);
    if (sanitizedValue !== undefined) acc[key] = sanitizedValue;
    return acc;
  }, {});
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

async function getAppealPolicy() {
  const [allowAppeals, appealWaitingDays] = await Promise.all([
    getConfigValue('auction.sanctions.allowAppeals', 'sandbox', true),
    getConfigValue('auction.sanctions.appealWaitingDays', 'sandbox', 365),
  ]);
  return {
    allowAppeals: Boolean(allowAppeals),
    appealWaitingDays: Number(appealWaitingDays) >= 0 ? Number(appealWaitingDays) : 365,
  };
}

export async function requestAuctionAppeal(input: {
  sanctionId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  reason: unknown;
  evidence?: unknown;
}) {
  const sanctionId = toObjectId(input.sanctionId);
  const actorId = toObjectId(input.actorId);
  const reason = String(input.reason || '').trim();
  if (reason.length < 10) reject(400, 'appeal_reason_required');

  const sanction = await AuctionSanction.findById(sanctionId);
  if (!sanction) reject(404, 'auction_sanction_not_found');
  if (String(sanction.userId) !== String(actorId)) reject(403, 'forbidden');
  if (sanction.status !== 'active') reject(409, 'auction_sanction_not_active');

  const policy = await getAppealPolicy();
  if (!policy.allowAppeals) reject(403, 'auction_appeals_disabled');
  const earliestAppealAt = new Date(sanction.startsAt.getTime() + policy.appealWaitingDays * 24 * 60 * 60_000);
  if (new Date() < earliestAppealAt) reject(409, 'auction_appeal_waiting_period_active');

  const active = await AuctionAppeal.exists({ sanctionId, status: { $in: activeAppealStatuses } });
  if (active) reject(409, 'auction_appeal_active_exists');

  try {
    const appeal = await AuctionAppeal.create({
      sanctionId,
      userId: actorId,
      reason,
      evidence: sanitizeEvidence(input.evidence),
      status: 'requested',
    });
    await audit(String(actorId), auctionAppealAuditActions.requested, {
      auctionAppealId: String(appeal._id),
      sanctionId: String(sanctionId),
    });
    await observeAuctionComplianceEvent({
      event: auctionAppealAuditActions.requested,
      entityId: appeal._id,
      sourceId: appeal._id,
      summary: 'Auction sanction appeal requested',
      metadata: {
        sanctionId: String(sanctionId),
        userId: String(actorId),
      },
      priority: 'high',
    });
    return appeal;
  } catch (error) {
    if ((error as any)?.code === 11000) reject(409, 'auction_appeal_active_exists');
    throw error;
  }
}

export async function listAuctionAppeals(filters: PaginationInput & {
  status?: AuctionAppealStatus;
  userId?: string;
  sanctionId?: string;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.userId) query.userId = toObjectId(filters.userId);
  if (filters.sanctionId) query.sanctionId = toObjectId(filters.sanctionId);

  const [total, appeals] = await Promise.all([
    AuctionAppeal.countDocuments(query),
    AuctionAppeal.find(query).sort({ createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, appeals };
}

export async function getAuctionAppeal(id: string | Types.ObjectId) {
  const appeal = await AuctionAppeal.findById(toObjectId(id)).lean();
  if (!appeal) reject(404, 'auction_appeal_not_found');
  return appeal;
}

async function resolveAuctionAppeal(input: {
  appealId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  status: 'approved' | 'rejected' | 'closed';
  resolution?: unknown;
}) {
  const appeal = await AuctionAppeal.findById(toObjectId(input.appealId));
  if (!appeal) reject(404, 'auction_appeal_not_found');
  if (!activeAppealStatuses.includes(appeal.status)) reject(409, 'auction_appeal_not_active');

  const actorId = toObjectId(input.actorId);
  appeal.status = input.status;
  appeal.reviewedBy = actorId;
  appeal.resolution = String(input.resolution || '').trim() || undefined;
  appeal.resolvedAt = new Date();
  await appeal.save();

  if (input.status === 'approved') {
    await AuctionSanction.updateOne(
      { _id: appeal.sanctionId, status: 'active' },
      { $set: { status: 'revoked', revokedBy: actorId, revokedAt: new Date() } }
    );
  }

  const actionByStatus = {
    approved: auctionAppealAuditActions.approved,
    rejected: auctionAppealAuditActions.rejected,
    closed: auctionAppealAuditActions.closed,
  };
  await audit(String(actorId), actionByStatus[input.status], {
    auctionAppealId: String(appeal._id),
    sanctionId: String(appeal.sanctionId),
  });
  if (input.status === 'approved' || input.status === 'rejected') {
    await observeAuctionComplianceEvent({
      event: input.status === 'approved'
        ? auctionAppealAuditActions.approved
        : auctionAppealAuditActions.rejected,
      entityId: appeal._id,
      sourceId: appeal._id,
      summary: `Auction sanction appeal ${input.status}`,
      metadata: {
        sanctionId: String(appeal.sanctionId),
        userId: String(appeal.userId),
        resolution: appeal.resolution,
      },
      priority: 'high',
    });
  }
  return appeal;
}

export function approveAuctionAppeal(input: {
  appealId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  resolution?: unknown;
}) {
  return resolveAuctionAppeal({ ...input, status: 'approved' });
}

export function rejectAuctionAppeal(input: {
  appealId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  resolution?: unknown;
}) {
  return resolveAuctionAppeal({ ...input, status: 'rejected' });
}

export function closeAuctionAppeal(input: {
  appealId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  resolution?: unknown;
}) {
  return resolveAuctionAppeal({ ...input, status: 'closed' });
}
