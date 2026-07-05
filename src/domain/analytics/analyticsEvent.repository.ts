import { FilterQuery, PipelineStage } from 'mongoose';
import { AnalyticsEvent, IAnalyticsEvent } from './analyticsEvent.model';

export async function createAnalyticsEvent(input: Partial<IAnalyticsEvent>) {
  return AnalyticsEvent.create(input);
}

export async function findAnalyticsEvent(query: FilterQuery<IAnalyticsEvent>) {
  return AnalyticsEvent.findOne(query).lean();
}

export async function listAnalyticsEvents(query: FilterQuery<IAnalyticsEvent>, skip = 0, limit = 50) {
  return AnalyticsEvent.find(query).sort({ occurredAt: -1, createdAt: -1 }).skip(skip).limit(limit).lean();
}

export async function countAnalyticsEvents(query: FilterQuery<IAnalyticsEvent>) {
  return AnalyticsEvent.countDocuments(query);
}

export async function aggregateAnalyticsEvents<T = unknown>(pipeline: PipelineStage[]) {
  return AnalyticsEvent.aggregate<T>(pipeline);
}
