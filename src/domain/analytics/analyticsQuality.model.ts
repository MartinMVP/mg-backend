import { Schema, model } from 'mongoose';
import {
  AnalyticsQualityClassification,
  AnalyticsQualityHealth,
  analyticsQualityClassifications,
  analyticsQualityHealth,
} from './analyticsQuality.types';

export interface IAnalyticsQualitySnapshot {
  score: number;
  classification: AnalyticsQualityClassification;
  health: AnalyticsQualityHealth;
  coverage: unknown;
  correlation: unknown;
  integrity: unknown;
  completeness: unknown;
  dimensions: unknown;
  tags: unknown;
  freshness: unknown;
  latency: unknown;
  blockingIssues: string[];
  warnings: string[];
  generatedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const analyticsQualitySnapshotSchema = new Schema<IAnalyticsQualitySnapshot>(
  {
    score: { type: Number, required: true, min: 0, max: 100, index: true },
    classification: { type: String, enum: analyticsQualityClassifications, required: true, index: true },
    health: { type: String, enum: analyticsQualityHealth, required: true, index: true },
    coverage: { type: Schema.Types.Mixed, required: true },
    correlation: { type: Schema.Types.Mixed, required: true },
    integrity: { type: Schema.Types.Mixed, required: true },
    completeness: { type: Schema.Types.Mixed, required: true },
    dimensions: { type: Schema.Types.Mixed, required: true },
    tags: { type: Schema.Types.Mixed, required: true },
    freshness: { type: Schema.Types.Mixed, required: true },
    latency: { type: Schema.Types.Mixed, required: true },
    blockingIssues: { type: [String], default: [] },
    warnings: { type: [String], default: [] },
    generatedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

function rejectAppendOnly() {
  throw new Error('analytics_quality_snapshot_append_only');
}

analyticsQualitySnapshotSchema.pre('updateOne', rejectAppendOnly);
analyticsQualitySnapshotSchema.pre('updateMany', rejectAppendOnly);
analyticsQualitySnapshotSchema.pre('findOneAndUpdate', rejectAppendOnly);
analyticsQualitySnapshotSchema.pre('deleteOne', rejectAppendOnly);
analyticsQualitySnapshotSchema.pre('deleteMany', rejectAppendOnly);
analyticsQualitySnapshotSchema.pre('findOneAndDelete', rejectAppendOnly);

analyticsQualitySnapshotSchema.index({ createdAt: -1 });

export const AnalyticsQualitySnapshot = model<IAnalyticsQualitySnapshot>(
  'AnalyticsQualitySnapshot',
  analyticsQualitySnapshotSchema
);
