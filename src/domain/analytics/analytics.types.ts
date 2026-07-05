import { Types } from 'mongoose';

export const analyticsDomains = [
  'marketplace',
  'membership',
  'revenue',
  'messaging',
  'auction_listings',
  'aoe',
  'platform',
  'admin',
] as const;
export type AnalyticsDomain = typeof analyticsDomains[number];

export const analyticsCategories = ['operational', 'business'] as const;
export type AnalyticsCategory = typeof analyticsCategories[number];

export const analyticsSources = ['audit', 'domain_event', 'system', 'manual', 'aoe'] as const;
export type AnalyticsSource = typeof analyticsSources[number];

export const analyticsEnvironments = ['sandbox', 'production'] as const;
export type AnalyticsEnvironment = typeof analyticsEnvironments[number];

export type AnalyticsDimensions = {
  country?: string;
  state?: string;
  municipality?: string;
  species?: string;
  breed?: string;
  membershipPlan?: string;
  auctionType?: string;
  channel?: string;
  device?: string;
  environment?: AnalyticsEnvironment;
};

export type AnalyticsEventInput = {
  domain: AnalyticsDomain;
  eventType: string;
  entityType: string;
  entityId: Types.ObjectId | string;
  actorId?: Types.ObjectId | string | null;
  occurredAt?: Date | string;
  metadata?: Record<string, unknown>;
  dimensions?: AnalyticsDimensions;
  tags?: string[];
  correlationId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  source?: AnalyticsSource;
  version?: number;
  analyticsCategory?: AnalyticsCategory;
};

export type AnalyticsEventFilters = {
  domain?: AnalyticsDomain;
  eventType?: string;
  category?: AnalyticsCategory;
  tag?: string;
  from?: string | Date;
  to?: string | Date;
  page?: unknown;
  limit?: unknown;
};

export type AnalyticsSummary = {
  totalEvents: number;
  eventsByDomain: Array<{ domain: AnalyticsDomain; count: number }>;
  eventsByCategory: Array<{ category: AnalyticsCategory; count: number }>;
  eventsByTag: Array<{ tag: string; count: number }>;
  eventsByType: Array<{ eventType: string; count: number }>;
  eventsLast24h: number;
  eventsLast7d: number;
};
