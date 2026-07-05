import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requestMembershipCheckout } from '../../domain/payments/payment.service';
import { getMembershipPaymentForUser } from '../../domain/payments/membershipPurchase.service';

const router = Router();

router.post('/account/membership/checkout', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await requestMembershipCheckout({
    userId: user.sub,
    planCode: String(req.body?.planCode ?? ''),
  });

  res.status(result.status).json(result.body);
});

router.get('/payments/:id', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const payment = await getMembershipPaymentForUser(String(req.params.id), user.sub);
  if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  res.json(payment);
});

export default router;
