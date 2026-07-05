import { Router } from 'express';
import { Audit } from '../../domain/audit/audit.model';
import { getAnalyticsSummary } from '../../domain/analytics/analyticsAggregation.service';
import { getAnalyticsCoverage } from '../../domain/analytics/analyticsCoverage.service';
import {
  getAnalyticsCompleteness,
  getAnalyticsFreshness,
  getAnalyticsIntegrity,
  getAnalyticsLatency,
  getCorrelationQuality,
  getDimensionsQuality,
  getTagsQuality,
} from '../../domain/analytics/analyticsIntegrity.service';
import {
  generateAnalyticsQualitySnapshot,
  getAnalyticsQuality,
  getAnalyticsQualityTrend,
  getAnalyticsReadiness,
} from '../../domain/analytics/analyticsQuality.service';
import {
  getBusinessAnalytics,
  getEventsByCorrelationId,
  getOperationalAnalytics,
  listAnalytics,
} from '../../domain/analytics/analyticsQuery.service';
import { analyticsAuditActions } from '../../domain/analytics/analytics.service';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

function handleAnalyticsError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;
  if (status) return res.status(status).json({ error: message });
  throw error;
}

async function audit(actor: string, action: string, payload: Record<string, unknown>) {
  await Audit.create({ actor, action, payload });
}

router.use(requireAuth, requireRole('admin', 'super'));

router.get('/analytics/summary', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const summary = await getAnalyticsSummary();
    await audit(user.sub, analyticsAuditActions.summaryViewed, {});
    res.json(summary);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/events', async (req, res, next) => {
  try {
    const result = await listAnalytics({
      domain: req.query.domain as any,
      eventType: req.query.eventType as any,
      category: req.query.category as any,
      tag: req.query.tag as any,
      from: req.query.from as any,
      to: req.query.to as any,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/events/correlation/:correlationId', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await getEventsByCorrelationId(String(req.params.correlationId), {
      page: req.query.page,
      limit: req.query.limit,
    });
    await audit(user.sub, analyticsAuditActions.correlationViewed, {
      correlationId: String(req.params.correlationId),
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/operational', async (req, res, next) => {
  try {
    const result = await getOperationalAnalytics({
      domain: req.query.domain as any,
      eventType: req.query.eventType as any,
      tag: req.query.tag as any,
      from: req.query.from as any,
      to: req.query.to as any,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/business', async (req, res, next) => {
  try {
    const result = await getBusinessAnalytics({
      domain: req.query.domain as any,
      eventType: req.query.eventType as any,
      tag: req.query.tag as any,
      from: req.query.from as any,
      to: req.query.to as any,
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/quality', async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await getAnalyticsQuality(user.sub));
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/readiness', async (req, res, next) => {
  try {
    const user = (req as any).user;
    res.json(await getAnalyticsReadiness(user.sub));
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/analytics/coverage', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsCoverage());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/correlation', async (_req, res, next) => {
  try {
    res.json(await getCorrelationQuality());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/dimensions', async (_req, res, next) => {
  try {
    res.json(await getDimensionsQuality());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/tags', async (_req, res, next) => {
  try {
    res.json(await getTagsQuality());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/integrity', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsIntegrity());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/completeness', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsCompleteness());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/freshness', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsFreshness());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/latency', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsLatency());
  } catch (error) {
    return next(error);
  }
});

router.get('/analytics/trend', async (_req, res, next) => {
  try {
    res.json(await getAnalyticsQualityTrend());
  } catch (error) {
    return next(error);
  }
});

router.post('/analytics/quality/snapshot', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const snapshot = await generateAnalyticsQualitySnapshot(user.sub);
    res.status(201).json(snapshot);
  } catch (error) {
    try {
      return handleAnalyticsError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
