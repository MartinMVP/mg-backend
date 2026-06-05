import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requestMembershipCheckout } from '../../domain/payments/payment.service';

const router = Router();

router.post('/account/membership/checkout', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await requestMembershipCheckout({
    userId: user.sub,
    planCode: String(req.body?.planCode ?? ''),
  });

  res.status(result.status).json(result.body);
});

export default router;
