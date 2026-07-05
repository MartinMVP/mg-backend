import { Audit } from '../audit/audit.model';
import { getConfigValue } from '../platformConfiguration/platformConfiguration.service';
import { AnalyticsEvent } from './analyticsEvent.model';
import {
  AnalyticsCompleteness,
  AnalyticsCorrelationQuality,
  AnalyticsDimensionsQuality,
  AnalyticsFreshness,
  AnalyticsIntegrity,
  AnalyticsLatency,
  AnalyticsTagsQuality,
} from './analyticsQuality.types';
import { analyticsCategories } from './analytics.types';

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return 100;
  return Math.round((numerator / denominator) * 100);
}

function scoreFromIssues(totalEvents: number, issueCount: number) {
  if (totalEvents === 0) return 100;
  return Math.max(0, Math.round(100 - (issueCount / totalEvents) * 100));
}

export async function getCorrelationQuality(): Promise<AnalyticsCorrelationQuality> {
  const [totalEvents, correlatedEvents] = await Promise.all([
    AnalyticsEvent.countDocuments(),
    AnalyticsEvent.countDocuments({ correlationId: { $nin: [null, ''] } }),
  ]);
  return {
    totalEvents,
    correlatedEvents,
    missingCorrelation: totalEvents - correlatedEvents,
    correlationCoverage: percent(correlatedEvents, totalEvents),
  };
}

export async function getDimensionsQuality(): Promise<AnalyticsDimensionsQuality> {
  const [totalEvents, eventsWithDimensions, topDimensions] = await Promise.all([
    AnalyticsEvent.countDocuments(),
    AnalyticsEvent.countDocuments({
      $expr: { $gt: [{ $size: { $objectToArray: { $ifNull: ['$dimensions', {}] } } }, 0] },
    }),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $project: { dimensions: { $objectToArray: { $ifNull: ['$dimensions', {}] } } } },
      { $unwind: '$dimensions' },
      { $group: { _id: '$dimensions.k', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  return {
    totalEvents,
    eventsWithDimensions,
    dimensionCoverage: percent(eventsWithDimensions, totalEvents),
    missingDimensions: totalEvents - eventsWithDimensions,
    topDimensions: topDimensions.map((item) => ({ dimension: item._id, count: item.count })),
  };
}

export async function getTagsQuality(): Promise<AnalyticsTagsQuality> {
  const [totalEvents, taggedEvents, topTags] = await Promise.all([
    AnalyticsEvent.countDocuments(),
    AnalyticsEvent.countDocuments({ tags: { $exists: true, $not: { $size: 0 } } }),
    AnalyticsEvent.aggregate<{ _id: string; count: number }>([
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
  ]);
  return {
    totalEvents,
    taggedEvents,
    tagCoverage: percent(taggedEvents, totalEvents),
    missingTags: totalEvents - taggedEvents,
    topTags: topTags.map((item) => ({ tag: item._id, count: item.count })),
  };
}

export async function getAnalyticsIntegrity(): Promise<AnalyticsIntegrity> {
  const [
    totalEvents,
    duplicateRows,
    invalidMetadataCount,
    invalidEntityCount,
    invalidTimestampCount,
    invalidCategoryCount,
  ] = await Promise.all([
    AnalyticsEvent.countDocuments(),
    AnalyticsEvent.aggregate<{ count: number }>([
      {
        $group: {
          _id: {
            domain: '$domain',
            eventType: '$eventType',
            entityType: '$entityType',
            entityId: '$entityId',
            occurredAt: '$occurredAt',
            correlationId: '$correlationId',
          },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $group: { _id: null, count: { $sum: { $subtract: ['$count', 1] } } } },
    ]),
    AnalyticsEvent.countDocuments({
      $expr: { $eq: [{ $size: { $objectToArray: { $ifNull: ['$metadata', {}] } } }, 0] },
    }),
    AnalyticsEvent.countDocuments({ $or: [{ entityId: { $exists: false } }, { entityId: null }, { entityId: '' }] }),
    AnalyticsEvent.countDocuments({ $or: [{ occurredAt: { $exists: false } }, { occurredAt: null }] }),
    AnalyticsEvent.countDocuments({ analyticsCategory: { $nin: analyticsCategories } }),
  ]);

  const duplicateCount = duplicateRows[0]?.count || 0;
  const orphanCount = 0;
  const issueCount = duplicateCount + orphanCount + invalidEntityCount + invalidTimestampCount + invalidCategoryCount;
  const issues = [];
  if (duplicateCount > 0) issues.push('potential_duplicates_detected');
  if (invalidMetadataCount > 0) issues.push('empty_metadata_detected');
  if (invalidEntityCount > 0) issues.push('invalid_entity_detected');
  if (invalidTimestampCount > 0) issues.push('invalid_timestamp_detected');
  if (invalidCategoryCount > 0) issues.push('invalid_category_detected');

  return {
    score: scoreFromIssues(totalEvents, issueCount),
    duplicateCount,
    orphanCount,
    invalidMetadataCount,
    invalidEntityCount,
    invalidTimestampCount,
    invalidCategoryCount,
    issues,
  };
}

export async function getAnalyticsCompleteness(): Promise<AnalyticsCompleteness> {
  const relevantAuditActions = [
    'AUCTION_DEFAULT_CONFIRMED',
    'AUCTION_SANCTION_APPLIED',
    'AOE_CASE_CREATED',
    'AOE_DECISION_PROPOSAL_CREATED',
  ];
  const [auditEvents, analyticsEvents, matchedRows] = await Promise.all([
    Audit.countDocuments({ action: { $in: relevantAuditActions } }),
    AnalyticsEvent.countDocuments({ eventType: { $in: relevantAuditActions } }),
    Audit.aggregate<{ _id: string }>([
      { $match: { action: { $in: relevantAuditActions } } },
      {
        $lookup: {
          from: 'analyticsevents',
          localField: 'action',
          foreignField: 'eventType',
          as: 'analyticsMatches',
        },
      },
      { $match: { 'analyticsMatches.0': { $exists: true } } },
      { $project: { _id: 1 } },
    ]),
  ]);
  const matchedEvents = matchedRows.length;
  const missingEvents = Math.max(0, auditEvents - matchedEvents);
  return {
    auditEvents,
    analyticsEvents,
    matchedEvents,
    missingEvents,
    completenessScore: percent(matchedEvents, auditEvents),
    warnings: ['completeness_uses_conservative_action_based_matching'],
  };
}

export async function getAnalyticsFreshness(): Promise<AnalyticsFreshness> {
  const [latest, freshSeconds, staleSeconds] = await Promise.all([
    AnalyticsEvent.findOne().sort({ occurredAt: -1 }).select('occurredAt').lean(),
    getConfigValue('analytics.quality.freshnessFreshSeconds', 'sandbox', 300),
    getConfigValue('analytics.quality.freshnessStaleSeconds', 'sandbox', 1800),
  ]);
  if (!latest?.occurredAt) {
    return { lastAnalyticsEvent: null, secondsBehind: null, status: 'no_data' };
  }
  const secondsBehind = Math.max(0, Math.round((Date.now() - new Date(latest.occurredAt).getTime()) / 1000));
  const status = secondsBehind < Number(freshSeconds)
    ? 'fresh'
    : secondsBehind <= Number(staleSeconds)
      ? 'delayed'
      : 'stale';
  return { lastAnalyticsEvent: latest.occurredAt, secondsBehind, status };
}

export async function getAnalyticsLatency(): Promise<AnalyticsLatency> {
  const events = await AnalyticsEvent.find().sort({ occurredAt: -1 }).limit(1000).select('occurredAt createdAt').lean();
  const latencies = events
    .map((event) => Math.max(0, new Date(event.createdAt).getTime() - new Date(event.occurredAt).getTime()))
    .sort((a, b) => a - b);
  if (latencies.length === 0) {
    return { avgLatencyMs: 0, p95LatencyMs: 0, maxLatencyMs: 0, sampleSize: 0, warnings: ['latency_has_no_samples'] };
  }
  const avgLatencyMs = Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);
  const p95Index = Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1);
  return {
    avgLatencyMs,
    p95LatencyMs: latencies[p95Index],
    maxLatencyMs: latencies[latencies.length - 1],
    sampleSize: latencies.length,
    warnings: latencies.length < 10 ? ['latency_sample_size_low'] : [],
  };
}
