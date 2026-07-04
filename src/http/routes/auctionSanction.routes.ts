import { Router } from 'express';
import { requestAuctionAppeal } from '../../domain/auctionAppeals/auctionAppeal.service';
import { requireAuth } from '../middlewares/auth';

const router = Router();

function handleAuctionSanctionError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.post('/:id/appeals', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const appeal = await requestAuctionAppeal({
      sanctionId: String(req.params.id),
      actorId: user.sub,
      reason: req.body?.reason,
      evidence: req.body?.evidence,
    });
    res.status(201).json(appeal);
  } catch (error) {
    try {
      return handleAuctionSanctionError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
