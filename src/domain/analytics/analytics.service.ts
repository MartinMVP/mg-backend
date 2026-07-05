import { Types } from 'mongoose';
import { AnalyticsEvent } from './analyticsEvent.model';
import { createAnalyticsEvent, findAnalyticsEvent } from './analyticsEvent.repository';
import {
  AnalyticsCategory,
  AnalyticsDimensions,
  AnalyticsEventInput,
  AnalyticsSource,
  analyticsCategories,
  analyticsDomains,
  analyticsSources,
} from './analytics.types';

export const analyticsAuditActions = {
  eventRecorded: 'ANALYTICS_EVENT_RECORDED',
  summaryViewed: 'ANALYTICS_SUMMARY_VIEWED',
  correlationViewed: 'ANALYTICS_CORRELATION_VIEWED',
} as const;

const operationalDomains = new Set(['aoe', 'messaging', 'platform', 'admin']);
const businessDomains = new Set(['marketplace', 'membership', 'revenue', 'auction_listings']);
const knownTags = new Set([
  'auction',
  'membership',
  'payment',
  'premium',
  'featured',
  'messaging',
  'aoe',
  'system',
  'admin',
  'revenue',
  'marketplace',
  'listing',
  'sanction',
  'appeal',
]);

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

function normalizeObjectIdOrString(value: Types.ObjectId | string) {
  const stringValue = String(value || '').trim();
  if (!stringValue) reject(400, 'analytics_entity_id_required');
  return Types.ObjectId.isValid(stringValue) ? new Types.ObjectId(stringValue) : stringValue;
}

function normalizeOptionalObjectId(value?: Types.ObjectId | string | null) {
  if (!value) return null;
  const stringValue = String(value);
  if (!Types.ObjectId.isValid(stringValue)) reject(400, 'analytics_actor_id_invalid');
  return new Types.ObjectId(stringValue);
}

function normalizeString(value: unknown, error: string) {
  const normalized = String(value || '').trim();
  if (!normalized) reject(400, error);
  return normalized;
}

function normalizeTags(tags: string[] = []) {
  return [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))];
}

function normalizeDimensions(dimensions: AnalyticsDimensions = {}) {
  const normalized: AnalyticsDimensions = {};
  for (const key of Object.keys(dimensions) as Array<keyof AnalyticsDimensions>) {
    const value = dimensions[key];
    if (value === undefined || value === null || value === '') continue;
    if (key === 'environment' && !['sandbox', 'production'].includes(String(value))) {
      reject(400, 'analytics_environment_invalid');
    }
    (normalized as any)[key] = String(value);
  }
  return normalized;
}

function inferCategory(domain: string, tags: string[]): AnalyticsCategory {
  if (operationalDomains.has(domain)) return 'operational';
  if (businessDomains.has(domain)) return 'business';
  if (tags.some((tag) => ['aoe', 'messaging', 'system', 'admin'].includes(tag))) return 'operational';
  return 'business';
}

function assertCategory(value: unknown, fallback: AnalyticsCategory): AnalyticsCategory {
  if (!value) return fallback;
  if (!analyticsCategories.includes(value as AnalyticsCategory)) reject(400, 'analytics_category_invalid');
  return value as AnalyticsCategory;
}

function assertSource(value: unknown): AnalyticsSource {
  if (!value) return 'domain_event';
  if (!analyticsSources.includes(value as AnalyticsSource)) reject(400, 'analytics_source_invalid');
  return value as AnalyticsSource;
}

export function isKnownAnalyticsTag(tag: string) {
  return knownTags.has(tag);
}

export async function recordAnalyticsEvent(input: AnalyticsEventInput) {
  if (!analyticsDomains.includes(input.domain)) reject(400, 'analytics_domain_invalid');

  const tags = normalizeTags(input.tags);
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (Number.isNaN(occurredAt.getTime())) reject(400, 'analytics_occurred_at_invalid');

  const normalized = {
    domain: input.domain,
    eventType: normalizeString(input.eventType, 'analytics_event_type_required'),
    entityType: normalizeString(input.entityType, 'analytics_entity_type_required'),
    entityId: normalizeObjectIdOrString(input.entityId),
    actorId: normalizeOptionalObjectId(input.actorId),
    occurredAt,
    metadata: input.metadata || {},
    dimensions: normalizeDimensions(input.dimensions),
    tags,
    correlationId: input.correlationId || null,
    sessionId: input.sessionId || null,
    requestId: input.requestId || null,
    source: assertSource(input.source),
    version: input.version || 1,
    analyticsCategory: assertCategory(input.analyticsCategory, inferCategory(input.domain, tags)),
  };

  const naturalKey = {
    source: normalized.source,
    domain: normalized.domain,
    eventType: normalized.eventType,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    occurredAt: normalized.occurredAt,
    correlationId: normalized.correlationId,
  };
  const existing = await findAnalyticsEvent(naturalKey);
  if (existing) return existing;

  return createAnalyticsEvent(normalized);
}

export async function getAnalyticsContextForEntity(entityType: string, entityId: string | Types.ObjectId) {
  const normalizedEntityId = normalizeObjectIdOrString(entityId);
  const query = { entityType: normalizeString(entityType, 'analytics_entity_type_required'), entityId: normalizedEntityId };
  const [totalEvents, events, tagAggregation, domainAggregation, correlationAggregation] = await Promise.all([
    AnalyticsEvent.countDocuments(query),
    AnalyticsEvent.find(query).sort({ occurredAt: -1 }).limit(10).lean(),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $match: query },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 },
    ]),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $match: query },
      { $group: { _id: '$domain', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
    AnalyticsEvent.distinct('correlationId', { ...query, correlationId: { $ne: null } }),
  ]);

  return {
    totalEvents,
    recentEvents: events,
    tags: tagAggregation.map((item) => ({ tag: item._id, count: item.count })),
    domains: domainAggregation.map((item) => ({ domain: item._id, count: item.count })),
    correlationIds: correlationAggregation,
  };
}
