import { Router } from 'express';
import {
  closeAOECase,
  escalateAOECase,
  getAOECase,
  listAOECases,
  markAOECaseViewed,
} from '../../domain/aoe/aoeCase.service';
import { getAOECapabilities } from '../../domain/aoe/aoeCapabilities.service';
import {
  listAOEDecisionProposalsForCase,
  setAOEDecisionProposalStatus,
} from '../../domain/aoe/aoeDecisionProposal.service';
import { listAOEEvidenceForCase } from '../../domain/aoe/aoeEvidence.service';
import {
  getAOEOperationalDecision,
  getOrCreateAOEOperationalDecisionForCase,
  listAOEOperationalDecisions,
  setAOEOperationalDecisionPackageStatus,
} from '../../domain/aoeOperationalDecisions/aoeOperationalDecision.service';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

function handleAOEError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (message === 'invalid_object_id') return res.status(400).json({ error: message });
  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.use(requireAuth, requireRole('admin', 'super'));

router.get('/aoe/capabilities', async (_req, res) => {
  res.json(getAOECapabilities());
});

router.get('/aoe/cases', async (req, res, next) => {
  try {
    const result = await listAOECases({
      page: req.query.page,
      limit: req.query.limit,
      status: req.query.status as any,
      type: req.query.type as any,
      priority: req.query.priority as any,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/cases/:id', async (req, res, next) => {
  try {
    const aoeCase = await getAOECase(String(req.params.id));
    res.json(aoeCase);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/cases/:id/evidence', async (req, res, next) => {
  try {
    await getAOECase(String(req.params.id));
    const evidence = await listAOEEvidenceForCase(String(req.params.id));
    res.json({ evidence });
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/cases/:id/proposals', async (req, res, next) => {
  try {
    await getAOECase(String(req.params.id));
    const proposals = await listAOEDecisionProposalsForCase(String(req.params.id));
    res.json({ proposals });
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/operational-decisions', async (req, res, next) => {
  try {
    const result = await listAOEOperationalDecisions({
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/operational-decisions/:id', async (req, res, next) => {
  try {
    const odp = await getAOEOperationalDecision(String(req.params.id));
    res.json(odp);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/aoe/cases/:id/operational-decision', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const odp = await getOrCreateAOEOperationalDecisionForCase({
      aoeCaseId: String(req.params.id),
      actorId: user.sub,
    });
    res.json(odp);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/operational-decisions/:id/view', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const odp = await setAOEOperationalDecisionPackageStatus({
      id: String(req.params.id),
      actorId: user.sub,
      status: 'viewed',
    });
    res.json(odp);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/operational-decisions/:id/escalate', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const odp = await setAOEOperationalDecisionPackageStatus({
      id: String(req.params.id),
      actorId: user.sub,
      status: 'escalated',
    });
    res.json(odp);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/operational-decisions/:id/close', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const odp = await setAOEOperationalDecisionPackageStatus({
      id: String(req.params.id),
      actorId: user.sub,
      status: 'closed',
    });
    res.json(odp);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/cases/:id/view', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const aoeCase = await markAOECaseViewed({ caseId: String(req.params.id), actorId: user.sub });
    res.json(aoeCase);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/cases/:id/escalate', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const aoeCase = await escalateAOECase({ caseId: String(req.params.id), actorId: user.sub });
    res.json(aoeCase);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/cases/:id/close', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const aoeCase = await closeAOECase({ caseId: String(req.params.id), actorId: user.sub });
    res.json(aoeCase);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/proposals/:id/view', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const proposal = await setAOEDecisionProposalStatus({
      proposalId: String(req.params.id),
      actorId: user.sub,
      status: 'viewed',
    });
    res.json(proposal);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/proposals/:id/escalate', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const proposal = await setAOEDecisionProposalStatus({
      proposalId: String(req.params.id),
      actorId: user.sub,
      status: 'escalated',
    });
    res.json(proposal);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/aoe/proposals/:id/close', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const proposal = await setAOEDecisionProposalStatus({
      proposalId: String(req.params.id),
      actorId: user.sub,
      status: 'closed',
    });
    res.json(proposal);
  } catch (error) {
    try {
      return handleAOEError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
