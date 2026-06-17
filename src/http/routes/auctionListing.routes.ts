import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  createAuctionListing,
  getAuctionListing,
  listAuctionBids,
  listAuctionListings,
  placeBid,
} from '../../domain/auctionListings/auctionListing.service';
import {
  recordAuctionCloseOutcome,
  reportSellerUnresponsive,
} from '../../domain/auctionOperations/auctionCloseOutcome.service';

const router = Router();

function handleAuctionListingError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.post('/', requireAuth, async (req, res, next) => {
  try {
    if (req.body?.sellerId) return res.status(400).json({ error: 'sellerId_not_allowed' });
    const user = (req as any).user;
    const auctionListing = await createAuctionListing({
      actorId: user.sub,
      listingId: req.body?.listingId,
      startingPrice: req.body?.startingPrice,
      durationDays: req.body?.durationDays,
    });
    res.status(201).json(auctionListing);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/', async (req, res, next) => {
  try {
    const result = await listAuctionListings({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as any,
      sellerId: req.query.sellerId as string | undefined,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const auctionListing = await getAuctionListing(String(req.params.id));
    res.json(auctionListing);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/:id/bids', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await placeBid({
      auctionListingId: String(req.params.id),
      bidderId: user.sub,
      amount: req.body?.amount,
    });
    res.status(201).json(result);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/:id/bids', async (req, res, next) => {
  try {
    const result = await listAuctionBids(String(req.params.id), {
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/:id/close-outcome', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const outcome = await recordAuctionCloseOutcome({
      auctionListingId: String(req.params.id),
      actorId: user.sub,
      outcome: req.body?.outcome,
    });
    res.status(201).json(outcome);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/:id/report-seller-unresponsive', requireAuth, async (req, res, next) => {
  try {
    const user = (req as any).user;
    const outcome = await reportSellerUnresponsive({
      auctionListingId: String(req.params.id),
      actorId: user.sub,
    });
    res.status(201).json(outcome);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
