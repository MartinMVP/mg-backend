import { Schema, model, Types } from 'mongoose';
import {
  AnalyticsCategory,
  AnalyticsDimensions,
  AnalyticsDomain,
  AnalyticsSource,
  analyticsCategories,
  analyticsDomains,
  analyticsSources,
} from './analytics.types';

export interface IAnalyticsEvent {
  domain: AnalyticsDomain;
  eventType: string;
  entityType: string;
  entityId: Types.ObjectId | string;
  actorId?: Types.ObjectId | null;
  occurredAt: Date;
  metadata: Record<string, unknown>;
  dimensions: AnalyticsDimensions;
  tags: string[];
  correlationId?: string | null;
  sessionId?: string | null;
  requestId?: string | null;
  source: AnalyticsSource;
  version: number;
  analyticsCategory: AnalyticsCategory;
  createdAt: Date;
  updatedAt: Date;
}

const analyticsEventSchema = new Schema<IAnalyticsEvent>(
  {
    domain: { type: String, enum: analyticsDomains, required: true, index: true },
    eventType: { type: String, required: true, trim: true, index: true },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: Schema.Types.Mixed, required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    occurredAt: { type: Date, required: true, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
    dimensions: {
      country: String,
      state: String,
      municipality: String,
      species: String,
      breed: String,
      membershipPlan: String,
      auctionType: String,
      channel: String,
      device: String,
      environment: { type: String, enum: ['sandbox', 'production'] },
    },
    tags: { type: [String], default: [], index: true },
    correlationId: { type: String, default: null, index: true },
    sessionId: { type: String, default: null, index: true },
    requestId: { type: String, default: null, index: true },
    source: { type: String, enum: analyticsSources, default: 'domain_event', index: true },
    version: { type: Number, default: 1, min: 1 },
    analyticsCategory: { type: String, enum: analyticsCategories, required: true, index: true },
  },
  { timestamps: true }
);

function rejectAppendOnly() {
  throw new Error('analytics_event_append_only');
}

analyticsEventSchema.pre('updateOne', rejectAppendOnly);
analyticsEventSchema.pre('updateMany', rejectAppendOnly);
analyticsEventSchema.pre('findOneAndUpdate', rejectAppendOnly);
analyticsEventSchema.pre('deleteOne', rejectAppendOnly);
analyticsEventSchema.pre('deleteMany', rejectAppendOnly);
analyticsEventSchema.pre('findOneAndDelete', rejectAppendOnly);

analyticsEventSchema.index({ domain: 1, eventType: 1, occurredAt: -1 });
analyticsEventSchema.index({ analyticsCategory: 1, occurredAt: -1 });
analyticsEventSchema.index({ correlationId: 1, occurredAt: -1 });
analyticsEventSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });
analyticsEventSchema.index({ createdAt: -1 });

export const AnalyticsEvent = model<IAnalyticsEvent>('AnalyticsEvent', analyticsEventSchema);
