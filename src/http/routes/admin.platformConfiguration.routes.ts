import { Router } from 'express';
import {
  getConfig,
  listConfigHistory,
  listConfigs,
  setConfig,
} from '../../domain/platformConfiguration/platformConfiguration.service';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

function handlePlatformConfigurationError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.get('/configurations', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listConfigs({
      page: req.query.page,
      limit: req.query.limit,
      environment: req.query.environment as any,
      key: req.query.key as string | undefined,
    });
    res.json(result);
  } catch (error) {
    try {
      return handlePlatformConfigurationError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/configurations/:key/history', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listConfigHistory(String(req.params.key), req.query.environment as any);
    res.json(result);
  } catch (error) {
    try {
      return handlePlatformConfigurationError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/configurations/:key', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const configuration = await getConfig(String(req.params.key), req.query.environment as any);
    if (!configuration) return res.status(404).json({ error: 'platform_configuration_not_found' });
    res.json(configuration);
  } catch (error) {
    try {
      return handlePlatformConfigurationError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/configurations', requireAuth, requireRole('super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const configuration = await setConfig({
      environment: req.body?.environment,
      key: req.body?.key,
      valueType: req.body?.valueType,
      value: req.body?.value,
      description: req.body?.description,
      isProtected: req.body?.isProtected,
      changedBy: user.sub,
    });
    res.status(201).json(configuration);
  } catch (error) {
    try {
      return handlePlatformConfigurationError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
