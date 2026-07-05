export const analyticsQualityClassifications = [
  'NOT_READY',
  'PARTIALLY_READY',
  'READY',
  'PRODUCTION_READY',
] as const;
export type AnalyticsQualityClassification = typeof analyticsQualityClassifications[number];

export const analyticsQualityHealth = ['HEALTHY', 'WARNING', 'CRITICAL'] as const;
export type AnalyticsQualityHealth = typeof analyticsQualityHealth[number];

export const analyticsFreshnessStatuses = ['fresh', 'delayed', 'stale', 'no_data'] as const;
export type AnalyticsFreshnessStatus = typeof analyticsFreshnessStatuses[number];

export const analyticsQualityTrends = ['improving', 'stable', 'degrading', 'insufficient_history'] as const;
export type AnalyticsQualityTrend = typeof analyticsQualityTrends[number];

export const analyticsRecommendedModes = ['normal', 'degraded', 'audit_fallback', 'blocked'] as const;
export type AnalyticsRecommendedMode = typeof analyticsRecommendedModes[number];

export type AnalyticsQualityScore = {
  score: number;
  classification: AnalyticsQualityClassification;
  health: AnalyticsQualityHealth;
};

export type AnalyticsCoverage = {
  overall: number;
  domains: Record<string, { overall: number; events: Record<string, number> }>;
};

export type AnalyticsCorrelationQuality = {
  totalEvents: number;
  correlatedEvents: number;
  missingCorrelation: number;
  correlationCoverage: number;
};

export type AnalyticsDimensionsQuality = {
  totalEvents: number;
  eventsWithDimensions: number;
  dimensionCoverage: number;
  missingDimensions: number;
  topDimensions: Array<{ dimension: string; count: number }>;
};

export type AnalyticsTagsQuality = {
  totalEvents: number;
  taggedEvents: number;
  tagCoverage: number;
  missingTags: number;
  topTags: Array<{ tag: string; count: number }>;
};

export type AnalyticsIntegrity = {
  score: number;
  duplicateCount: number;
  orphanCount: number;
  invalidMetadataCount: number;
  invalidEntityCount: number;
  invalidTimestampCount: number;
  invalidCategoryCount: number;
  issues: string[];
};

export type AnalyticsCompleteness = {
  auditEvents: number;
  analyticsEvents: number;
  matchedEvents: number;
  missingEvents: number;
  completenessScore: number;
  warnings: string[];
};

export type AnalyticsFreshness = {
  lastAnalyticsEvent: Date | null;
  secondsBehind: number | null;
  status: AnalyticsFreshnessStatus;
};

export type AnalyticsLatency = {
  avgLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  sampleSize: number;
  warnings: string[];
};

export type AnalyticsQualityTrendResult = {
  previousScore: number | null;
  currentScore: number;
  delta: number | null;
  trend: AnalyticsQualityTrend;
};

export type AnalyticsReadiness = {
  overallScore: number;
  classification: AnalyticsQualityClassification;
  health: AnalyticsQualityHealth;
  coverage: AnalyticsCoverage;
  correlation: AnalyticsCorrelationQuality;
  integrity: AnalyticsIntegrity;
  completeness: AnalyticsCompleteness;
  dimensions: AnalyticsDimensionsQuality;
  tags: AnalyticsTagsQuality;
  freshness: AnalyticsFreshness;
  latency: AnalyticsLatency;
  recommendation: string;
  blockingIssues: string[];
  warnings: string[];
  generatedAt: string;
};

export type AnalyticsQualityGates = {
  passed: boolean;
  failedGates: string[];
  warnings: string[];
  recommendedMode: AnalyticsRecommendedMode;
};
