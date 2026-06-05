import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import { PaymentCheckoutSession } from '../../domain/payments/paymentCheckoutSession.model';
import { PaymentCustomer } from '../../domain/payments/paymentCustomer.model';
import { PaymentRecord } from '../../domain/payments/paymentRecord.model';
import { PaymentWebhookLog } from '../../domain/payments/paymentWebhookLog.model';

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

export default router;
