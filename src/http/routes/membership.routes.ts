import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getUserMembership } from '../../domain/memberships/membership.service';

const router = Router();

router.get('/account/membership', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const membership = await getUserMembership(user.sub);

  res.json(membership);
});

export default router;
