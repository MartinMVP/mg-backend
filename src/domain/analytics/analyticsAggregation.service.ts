import { AnalyticsEvent } from './analyticsEvent.model';
import { AnalyticsSummary } from './analytics.types';

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60_000);
}

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60_000);
}

async function groupBy(field: string, name: string, limit = 10) {
  const rows = await AnalyticsEvent.aggregate<{ _id: string; count: number }>([
    { $unwind: field === 'tags' ? '$tags' : { path: `$${field}`, preserveNullAndEmptyArrays: false } },
    { $group: { _id: `$${field}`, count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: limit },
  ]);
  return rows.map((row) => ({ [name]: row._id, count: row.count }));
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  const last24h = hoursAgo(24);
  const last7d = daysAgo(7);
  const [
    totalEvents,
    eventsByDomain,
    eventsByCategory,
    eventsByTag,
    eventsByType,
    eventsLast24h,
    eventsLast7d,
  ] = await Promise.all([
    AnalyticsEvent.countDocuments(),
    groupBy('domain', 'domain'),
    groupBy('analyticsCategory', 'category'),
    groupBy('tags', 'tag'),
    groupBy('eventType', 'eventType'),
    AnalyticsEvent.countDocuments({ occurredAt: { $gte: last24h } }),
    AnalyticsEvent.countDocuments({ occurredAt: { $gte: last7d } }),
  ]);

  return {
    totalEvents,
    eventsByDomain: eventsByDomain as AnalyticsSummary['eventsByDomain'],
    eventsByCategory: eventsByCategory as AnalyticsSummary['eventsByCategory'],
    eventsByTag: eventsByTag as AnalyticsSummary['eventsByTag'],
    eventsByType: eventsByType as AnalyticsSummary['eventsByType'],
    eventsLast24h,
    eventsLast7d,
  };
}
