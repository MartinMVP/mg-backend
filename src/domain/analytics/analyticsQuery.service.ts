import { FilterQuery } from 'mongoose';
import { AnalyticsEvent, IAnalyticsEvent } from './analyticsEvent.model';
import { countAnalyticsEvents, listAnalyticsEvents } from './analyticsEvent.repository';
import {
  AnalyticsCategory,
  AnalyticsDomain,
  AnalyticsEventFilters,
  analyticsCategories,
  analyticsDomains,
} from './analytics.types';

const defaultLimit = 50;
const maxLimit = 100;

function reject(status: number, message: string): never {
  const error = new Error(message);
  (error as any).status = status;
  throw error;
}

function normalizePagination(pageInput: unknown, limitInput: unknown) {
  const parsedPage = Number(pageInput);
  const parsedLimit = Number(limitInput);
  const page = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const limit = Number.isFinite(parsedLimit) && parsedLimit >= 1
    ? Math.min(Math.floor(parsedLimit), maxLimit)
    : defaultLimit;
  return { page, limit, skip: (page - 1) * limit };
}

function assertDomain(value: unknown): AnalyticsDomain {
  if (!analyticsDomains.includes(value as AnalyticsDomain)) reject(400, 'analytics_domain_invalid');
  return value as AnalyticsDomain;
}

function assertCategory(value: unknown): AnalyticsCategory {
  if (!analyticsCategories.includes(value as AnalyticsCategory)) reject(400, 'analytics_category_invalid');
  return value as AnalyticsCategory;
}

function buildQuery(filters: AnalyticsEventFilters = {}): FilterQuery<IAnalyticsEvent> {
  const query: FilterQuery<IAnalyticsEvent> = {};
  if (filters.domain) query.domain = assertDomain(filters.domain);
  if (filters.eventType) query.eventType = String(filters.eventType);
  if (filters.category) query.analyticsCategory = assertCategory(filters.category);
  if (filters.tag) query.tags = String(filters.tag).trim().toLowerCase();

  const occurredAt: Record<string, Date> = {};
  if (filters.from) {
    const from = new Date(filters.from);
    if (Number.isNaN(from.getTime())) reject(400, 'analytics_from_invalid');
    occurredAt.$gte = from;
  }
  if (filters.to) {
    const to = new Date(filters.to);
    if (Number.isNaN(to.getTime())) reject(400, 'analytics_to_invalid');
    occurredAt.$lte = to;
  }
  if (Object.keys(occurredAt).length > 0) query.occurredAt = occurredAt;
  return query;
}

export async function listAnalytics(filters: AnalyticsEventFilters = {}) {
  const pagination = normalizePagination(filters.page, filters.limit);
  const query = buildQuery(filters);
  const [total, events] = await Promise.all([
    countAnalyticsEvents(query),
    listAnalyticsEvents(query, pagination.skip, pagination.limit),
  ]);
  return { page: pagination.page, limit: pagination.limit, total, events };
}

export async function getDomainAnalytics(domain: AnalyticsDomain, filters: AnalyticsEventFilters = {}) {
  return listAnalytics({ ...filters, domain });
}

export async function getOperationalAnalytics(filters: AnalyticsEventFilters = {}) {
  return listAnalytics({ ...filters, category: 'operational' });
}

export async function getBusinessAnalytics(filters: AnalyticsEventFilters = {}) {
  return listAnalytics({ ...filters, category: 'business' });
}

export async function getEventsByCorrelationId(correlationId: string, filters: AnalyticsEventFilters = {}) {
  const normalized = String(correlationId || '').trim();
  if (!normalized) reject(400, 'analytics_correlation_id_required');
  const pagination = normalizePagination(filters.page, filters.limit);
  const query = { ...buildQuery(filters), correlationId: normalized };
  const [total, events] = await Promise.all([
    AnalyticsEvent.countDocuments(query),
    AnalyticsEvent.find(query).sort({ occurredAt: -1, createdAt: -1 }).skip(pagination.skip).limit(pagination.limit).lean(),
  ]);
  return { page: pagination.page, limit: pagination.limit, total, events };
}
