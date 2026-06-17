import { Router } from 'express';
import { closeAuctionListing } from '../../domain/auctionListings/auctionListing.service';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

function handleAuctionListingError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.post('/auction-listings/:id/close', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const auctionListing = await closeAuctionListing(String(req.params.id), {
      actorId: user.sub,
      manual: true,
    });
    res.json(auctionListing);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
