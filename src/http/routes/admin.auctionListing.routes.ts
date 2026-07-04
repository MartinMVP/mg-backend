import { Router } from 'express';
import { closeAuctionListing } from '../../domain/auctionListings/auctionListing.service';
import {
  confirmAuctionDefault,
  getAuctionDefault,
  listAuctionDefaults,
  rejectAuctionDefault,
} from '../../domain/auctionDefaults/auctionDefault.service';
import {
  applyAuctionSanction,
  getAuctionSanction,
  listAuctionSanctions,
  revokeAuctionSanction,
} from '../../domain/auctionSanctions/auctionSanction.service';
import {
  approveAuctionAppeal,
  closeAuctionAppeal,
  getAuctionAppeal,
  listAuctionAppeals,
  rejectAuctionAppeal,
} from '../../domain/auctionAppeals/auctionAppeal.service';
import {
  getAuctionCloseOutcome,
  listAuctionCloseOutcomes,
} from '../../domain/auctionOperations/auctionCloseOutcome.service';
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

router.get('/auction-close-outcomes', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listAuctionCloseOutcomes({
      page: req.query.page,
      limit: req.query.limit,
      outcome: req.query.outcome as any,
      auctionListingId: req.query.auctionListingId as string | undefined,
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

router.get('/auction-close-outcomes/:id', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const outcome = await getAuctionCloseOutcome(String(req.params.id));
    res.json(outcome);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/auction-defaults', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listAuctionDefaults({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as any,
      auctionListingId: req.query.auctionListingId as string | undefined,
      reportedUserId: req.query.reportedUserId as string | undefined,
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

router.get('/auction-defaults/:id', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const report = await getAuctionDefault(String(req.params.id));
    res.json(report);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-defaults/:id/confirm', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await confirmAuctionDefault({
      defaultId: String(req.params.id),
      actorId: user.sub,
      resolutionType: req.body?.resolutionType,
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

router.post('/auction-defaults/:id/reject', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const report = await rejectAuctionDefault({
      defaultId: String(req.params.id),
      actorId: user.sub,
      resolutionType: req.body?.resolutionType,
    });
    res.json(report);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/auction-sanctions', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listAuctionSanctions({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as string | undefined,
      userId: req.query.userId as string | undefined,
      type: req.query.type as any,
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

router.get('/auction-sanctions/:id', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const sanction = await getAuctionSanction(String(req.params.id));
    res.json(sanction);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-sanctions/apply', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const sanction = await applyAuctionSanction({
      actorId: user.sub,
      recommendation: req.body?.recommendation,
    });
    res.status(201).json(sanction);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-sanctions/:id/revoke', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const sanction = await revokeAuctionSanction({ sanctionId: String(req.params.id), actorId: user.sub });
    res.json(sanction);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/auction-appeals', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const result = await listAuctionAppeals({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as any,
      userId: req.query.userId as string | undefined,
      sanctionId: req.query.sanctionId as string | undefined,
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

router.get('/auction-appeals/:id', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const appeal = await getAuctionAppeal(String(req.params.id));
    res.json(appeal);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-appeals/:id/approve', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const appeal = await approveAuctionAppeal({ appealId: String(req.params.id), actorId: user.sub, resolution: req.body?.resolution });
    res.json(appeal);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-appeals/:id/reject', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const appeal = await rejectAuctionAppeal({ appealId: String(req.params.id), actorId: user.sub, resolution: req.body?.resolution });
    res.json(appeal);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/auction-appeals/:id/close', requireAuth, requireRole('admin', 'super'), async (req, res, next) => {
  try {
    const user = (req as any).user;
    const appeal = await closeAuctionAppeal({ appealId: String(req.params.id), actorId: user.sub, resolution: req.body?.resolution });
    res.json(appeal);
  } catch (error) {
    try {
      return handleAuctionListingError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
