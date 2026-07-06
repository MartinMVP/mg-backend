import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  cancelFiscalInvoice,
  createFiscalOperation,
  getFiscalHistory,
  getFiscalOperation,
} from '../../domain/fiscalOperations/fiscalPlatform.service';

const router = Router();

function handleFiscalPlatformError(res: any, error: unknown) {
  const status = (error as any)?.status || 500;
  const message = error instanceof Error ? error.message : String(error);
  if (status >= 500) throw error;
  return res.status(status).json({ error: message });
}

router.post('/fiscal/operations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await createFiscalOperation({
      commercialOperationId: String(req.body?.commercialOperationId || req.body?.operationId || ''),
      provider: req.body?.provider,
      metadata: req.body?.metadata,
      actorId: user.sub,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    try { return handleFiscalPlatformError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/fiscal/operations/:id', requireAuth, async (req, res, next) => {
  try {
    const operation = await getFiscalOperation(String(req.params.id));
    if (!operation) return res.status(404).json({ error: 'fiscal_operation_not_found' });
    res.json(operation);
  } catch (error) {
    try { return handleFiscalPlatformError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/fiscal/history/:operationId', requireAuth, async (req, res, next) => {
  try {
    const history = await getFiscalHistory(String(req.params.operationId));
    if (!history) return res.status(404).json({ error: 'fiscal_history_not_found' });
    res.json(history);
  } catch (error) {
    try { return handleFiscalPlatformError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.post('/fiscal/invoices/:id/cancel', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await cancelFiscalInvoice({
      fiscalOperationId: String(req.params.id),
      actorId: user.sub,
      reason: String(req.body?.reason || '02'),
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    try { return handleFiscalPlatformError(res, error); } catch (nextError) { return next(nextError); }
  }
});

export default router;
