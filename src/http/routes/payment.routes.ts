import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requestMembershipCheckout } from '../../domain/payments/payment.service';
import { getMembershipPaymentForUser } from '../../domain/payments/membershipPurchase.service';
import {
  createCommercialOperation,
  createPaymentIntent,
  getCommercialOperation,
  listPaymentTransactions,
  requestRefund,
} from '../../domain/payments/commercialRevenue.service';

const router = Router();

function handleRevenueError(res: any, error: unknown) {
  const status = (error as any)?.status || 500;
  const message = error instanceof Error ? error.message : String(error);
  if (status >= 500) throw error;
  return res.status(status).json({ error: message });
}

router.post('/account/membership/checkout', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await requestMembershipCheckout({
    userId: user.sub,
    planCode: String(req.body?.planCode ?? ''),
  });

  res.status(result.status).json(result.body);
});

router.post('/payments/operations', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const operation = await createCommercialOperation({ ...req.body, actorId: user.sub });
    res.status(201).json(operation);
  } catch (error) {
    try { return handleRevenueError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/payments/operations/:id', requireAuth, async (req, res, next) => {
  try {
    const operation = await getCommercialOperation(String(req.params.id));
    if (!operation) return res.status(404).json({ error: 'operation_not_found' });
    res.json(operation);
  } catch (error) {
    try { return handleRevenueError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.post('/payments/checkout', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const transaction = await createPaymentIntent({ operationId: String(req.body?.operationId || ''), actorId: user.sub });
    res.status(201).json(transaction);
  } catch (error) {
    try { return handleRevenueError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/payments/transactions', requireAuth, async (req, res) => {
  res.json(await listPaymentTransactions(req.query));
});

router.post('/payments/refunds', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await requestRefund({
      operationId: String(req.body?.operationId || ''),
      amount: req.body?.amount,
      reason: req.body?.reason,
      actorId: user.sub,
    });
    res.status(result.status).json(result.body);
  } catch (error) {
    try { return handleRevenueError(res, error); } catch (nextError) { return next(nextError); }
  }
});

router.get('/payments/:id', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const payment = await getMembershipPaymentForUser(String(req.params.id), user.sub);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  res.json(payment);
});

export default router;
