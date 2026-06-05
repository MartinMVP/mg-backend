import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';
import { DunningState } from '../../domain/payments/dunningState.model';
import { processDunningDue } from '../../domain/payments/dunning.service';

const router = Router();

function requireAdmin(req: any, res: any, next: any) {
  return requireRole('admin', 'super')(req, res, next);
}

function parsePagination(query: any) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

  return { page, limit };
}

router.use(requireAuth, requireAdmin);

router.get('/payments/customers', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentCustomer.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/checkout-sessions', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentCheckoutSession.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/records', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentRecord.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/webhook-logs', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await PaymentWebhookLog.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/dunning', async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const items = await DunningState.find()
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .select('-__v')
    .lean();

  res.json({ items, page, limit });
});

router.get('/payments/dunning/:id', async (req, res) => {
  if (!req.params.id.match(/^[a-f\d]{24}$/i)) {
    return res.status(400).json({ error: 'Invalid dunning id' });
  }

  const item = await DunningState.findById(req.params.id).select('-__v').lean();
  if (!item) return res.status(404).json({ error: 'Not found' });

  res.json(item);
});

router.post('/payments/dunning/process-due', async (_req, res) => {
  const result = await processDunningDue();
  res.json(result);
});

export default router;
