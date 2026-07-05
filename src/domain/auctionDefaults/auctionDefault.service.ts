import { Types } from 'mongoose';
import { recordAnalyticsEvent } from '../analytics/analytics.service';
import { Audit } from '../audit/audit.model';
import { AuctionListing } from '../auctionListings/auctionListing.model';
import { Conversation } from '../messaging/conversation.model';
import { sendSystemMessage } from '../messaging/messaging.service';
import {
  auctionDefaultCategories,
  AuctionDefaultCategory,
  AuctionDefaultReport,
  auctionDefaultResolutionTypes,
  AuctionDefaultResolutionType,
  AuctionDefaultStatus,
} from './auctionDefault.model';
import {
  countAuctionDefaultReports,
  createAuctionDefaultReport,
  findActiveAuctionDefaultReport,
  findAuctionDefaultReportById,
  listAuctionDefaultReports,
} from './auctionDefault.repository';
import { buildAuctionSanctionRecommendation } from '../auctionSanctions/auctionSanction.service';
import { observeAuctionComplianceEvent } from '../aoe/aoeCase.service';

export const auctionDefaultAuditActions = {
  reported: 'AUCTION_DEFAULT_REPORTED',
  confirmed: 'AUCTION_DEFAULT_CONFIRMED',
  rejected: 'AUCTION_DEFAULT_REJECTED',
} as const;

const defaultLimit = 20;
const maxLimit = 100;
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

function assertCategory(value: unknown): AuctionDefaultCategory {
  if (!auctionDefaultCategories.includes(value as AuctionDefaultCategory)) reject(400, 'invalid_default_category');
  return value as AuctionDefaultCategory;
}

function assertResolutionType(value: unknown): AuctionDefaultResolutionType {
  if (!auctionDefaultResolutionTypes.includes(value as AuctionDefaultResolutionType)) {
    reject(400, 'invalid_default_resolution_type');
  }
  return value as AuctionDefaultResolutionType;
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

async function getAuctionConversation(auctionListingId: Types.ObjectId) {
  return Conversation.findOne({
    type: 'auction',
    auctionListingId,
    status: { $ne: 'deleted' },
  }).sort({ createdAt: -1 });
}

export async function reportAuctionDefault(input: {
  auctionListingId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  reportedUserId: string | Types.ObjectId;
  category: unknown;
  description: unknown;
  evidence?: unknown;
}) {
  const auctionListingId = toObjectId(input.auctionListingId);
  const actorId = toObjectId(input.actorId);
  const reportedUserId = toObjectId(input.reportedUserId);
  const category = assertCategory(input.category);
  const description = String(input.description || '').trim();
  if (description.length < 10) reject(400, 'default_description_required');
  if (String(actorId) === String(reportedUserId)) reject(400, 'cannot_report_self');

  const auctionListing = await AuctionListing.findById(auctionListingId);
  if (!auctionListing) reject(404, 'auction_listing_not_found');
  if (auctionListing.status !== 'closed') reject(409, 'auction_listing_not_closed');
  if (!auctionListing.winnerUserId) reject(409, 'auction_listing_has_no_winner');

  const sellerId = String(auctionListing.sellerId);
  const winnerId = String(auctionListing.winnerUserId);
  const actor = String(actorId);
  const reported = String(reportedUserId);
  if (![sellerId, winnerId].includes(actor) || ![sellerId, winnerId].includes(reported)) reject(403, 'forbidden');
  if (!((actor === sellerId && reported === winnerId) || (actor === winnerId && reported === sellerId))) {
    reject(403, 'forbidden');
  }

  const conversation = await getAuctionConversation(auctionListingId);
  if (!conversation) reject(409, 'auction_conversation_required');

  const existing = await findActiveAuctionDefaultReport(auctionListingId, reportedUserId);
  if (existing) reject(409, 'auction_default_active_report_exists');

  const role = reported === winnerId ? 'buyer' : 'seller';
  const report = await createAuctionDefaultReport({
    auctionListingId,
    conversationId: conversation._id,
    reporterUserId: actorId,
    reportedUserId,
    role,
    category,
    description,
    evidence: sanitizeEvidence(input.evidence),
    status: 'pending',
  });

  await sendSystemMessage({
    conversationId: conversation._id,
    actorId,
    source: 'auction',
    body: 'Se registro un reporte de incumplimiento para revision administrativa.',
    eventKey: `auction-default-reported:${report._id}`,
    metadata: {
      auctionListingId: String(auctionListingId),
      auctionDefaultReportId: String(report._id),
    },
  });
  await audit(String(actorId), auctionDefaultAuditActions.reported, {
    auctionDefaultReportId: String(report._id),
    auctionListingId: String(auctionListingId),
    reportedUserId: String(reportedUserId),
    role,
  });

  return report;
}

export async function listAuctionDefaults(filters: PaginationInput & {
  status?: AuctionDefaultStatus;
  auctionListingId?: string;
  reportedUserId?: string;
} = {}) {
  const pagination = normalizePagination(filters);
  const query: Record<string, unknown> = {};
  if (filters.status) query.status = filters.status;
  if (filters.auctionListingId) query.auctionListingId = toObjectId(filters.auctionListingId);
  if (filters.reportedUserId) query.reportedUserId = toObjectId(filters.reportedUserId);

  const [total, defaults] = await Promise.all([
    countAuctionDefaultReports(query),
    listAuctionDefaultReports(query, pagination.skip, pagination.limit),
  ]);

  return { page: pagination.page, limit: pagination.limit, total, defaults };
}

export async function getAuctionDefault(id: string | Types.ObjectId) {
  const report = await AuctionDefaultReport.findById(toObjectId(id)).lean();
  if (!report) reject(404, 'auction_default_not_found');
  return report;
}

export async function confirmAuctionDefault(input: {
  defaultId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  resolutionType?: unknown;
}) {
  const actorId = toObjectId(input.actorId);
  const report = await findAuctionDefaultReportById(toObjectId(input.defaultId));
  if (!report) reject(404, 'auction_default_not_found');
  if (report.status !== 'pending') reject(409, 'auction_default_not_pending');
  const resolutionType = input.resolutionType
    ? assertResolutionType(input.resolutionType)
    : report.role === 'buyer' ? 'buyer_default' : 'seller_default';
  if (!['buyer_default', 'seller_default'].includes(resolutionType)) reject(400, 'invalid_confirmation_resolution_type');

  report.status = 'confirmed';
  report.resolutionType = resolutionType;
  report.reviewedBy = actorId;
  report.reviewedAt = new Date();
  await report.save();

  const recommendation = await buildAuctionSanctionRecommendation(report._id);
  await audit(String(actorId), auctionDefaultAuditActions.confirmed, {
    auctionDefaultReportId: String(report._id),
    auctionListingId: String(report.auctionListingId),
    recommendation,
  });
  await recordAnalyticsEvent({
    domain: 'auction_listings',
    eventType: auctionDefaultAuditActions.confirmed,
    entityType: 'auction',
    entityId: report.auctionListingId,
    actorId,
    metadata: {
      auctionDefaultReportId: String(report._id),
      role: report.role,
      resolutionType: report.resolutionType,
    },
    tags: ['auction', 'sanction'],
    source: 'domain_event',
    analyticsCategory: 'business',
  });
  await observeAuctionComplianceEvent({
    event: auctionDefaultAuditActions.confirmed,
    entityId: report.auctionListingId,
    sourceId: report._id,
    summary: `${report.role} default confirmed for Auction Listing`,
    metadata: {
      auctionDefaultReportId: String(report._id),
      resolutionType,
      role: report.role,
      recommendation,
    },
  });
  return { default: report, recommendation };
}

export async function rejectAuctionDefault(input: {
  defaultId: string | Types.ObjectId;
  actorId: string | Types.ObjectId;
  resolutionType?: unknown;
}) {
  const actorId = toObjectId(input.actorId);
  const report = await findAuctionDefaultReportById(toObjectId(input.defaultId));
  if (!report) reject(404, 'auction_default_not_found');
  if (report.status !== 'pending') reject(409, 'auction_default_not_pending');
  const resolutionType = input.resolutionType
    ? assertResolutionType(input.resolutionType)
    : 'no_default';
  if (!['no_default', 'insufficient_evidence', 'administrative_closure'].includes(resolutionType)) {
    reject(400, 'invalid_rejection_resolution_type');
  }

  report.status = 'rejected';
  report.resolutionType = resolutionType;
  report.reviewedBy = actorId;
  report.reviewedAt = new Date();
  await report.save();

  await audit(String(actorId), auctionDefaultAuditActions.rejected, {
    auctionDefaultReportId: String(report._id),
    auctionListingId: String(report.auctionListingId),
  });
  return report;
}
