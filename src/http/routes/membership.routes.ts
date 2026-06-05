import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { getUserMembership } from '../../domain/memberships/membership.service';
import { getMembershipCapacity } from '../../domain/memberships/membershipCatalogPolicy';
import {
  reactivateMembership,
  requestCancellation,
  requestPlanChange,
} from '../../domain/memberships/membershipChange.service';

const router = Router();

function membershipChangeError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'membership_plan_code_required') return res.status(400).json({ error: message });
  if (message === 'membership_plan_not_found') return res.status(404).json({ error: message });
  if (message === 'membership_not_found') return res.status(404).json({ error: message });
  throw error;
}

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

router.post('/account/membership/change-plan', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await requestPlanChange({
      userId: user.sub,
      targetPlanCode: String(req.body?.targetPlanCode || req.body?.planCode || ''),
      source: 'user',
    });

    res.status(result.requiresCheckout ? 409 : 200).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/account/membership/cancel', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await requestCancellation({
      userId: user.sub,
      reason: req.body?.reason ? String(req.body.reason) : undefined,
      source: 'user',
    });

    res.json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

router.post('/account/membership/reactivate', requireAuth, async (req, res) => {
  const user = (req as any).user;
  try {
    const result = await reactivateMembership({
      userId: user.sub,
      source: 'user',
    });

    res.status(result.ok ? 200 : 409).json(result);
  } catch (error) {
    return membershipChangeError(res, error);
  }
});

export default router;
