import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getUserMembership } from '../../domain/memberships/membership.service';
import { getMembershipCapacity } from '../../domain/memberships/membershipCatalogPolicy';

const router = Router();

router.get('/account/membership', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const membership = await getUserMembership(user.sub);

  res.json(membership);
});

router.get('/account/membership/capacity', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const capacity = await getMembershipCapacity(user.sub);

  res.json({
    plan: capacity.plan?.code ?? null,
    activeListings: capacity.activeListings,
    maxActiveListings: capacity.maxActiveListings,
    remaining: capacity.grantsBenefits ? capacity.remaining : 0,
  });
});

export default router;
