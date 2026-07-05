import { Router } from 'express';
import { Audit } from '../../domain/audit/audit.model';
import { getAnalyticsSummary } from '../../domain/analytics/analyticsAggregation.service';
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

export default router;
