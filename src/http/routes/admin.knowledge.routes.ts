import { Router } from 'express';
import {
  createKnowledgeRecord,
  createKnowledgeRecordVersion,
  getKnowledgeRecord,
  listKnowledgeRecords,
} from '../../domain/knowledge/knowledgeRecord.service';
import {
  createKnowledgeCollection,
  getKnowledgeCollection,
  listKnowledgeCollections,
} from '../../domain/knowledge/knowledgeCollection.service';
import {
  getKnowledgeAsset,
  listKnowledgeAssets,
} from '../../domain/knowledge/knowledgeAsset.service';
import { getKnowledgeManagementMetrics } from '../../domain/knowledge/knowledgeMetrics.service';
import {
  getKnowledgeSnapshot,
  getKnowledgeUtilizationPackage,
  resolveKnowledge,
} from '../../domain/knowledge/knowledgeResolution.service';
import { getKnowledgeUtilizationMetrics } from '../../domain/knowledge/knowledgeUtilizationMetrics.service';
import { listKnowledgeRegistry } from '../../domain/knowledge/knowledgeRegistry.service';
import {
  getOutcome,
  listOutcomeRegistry,
  registerOutcome,
} from '../../domain/knowledge/knowledgeOutcome.service';
import {
  getValidation,
  getValidationHistory,
  listDrift,
  listValidations,
  validateKnowledge,
} from '../../domain/knowledge/knowledgeValidation.service';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

function handleKnowledgeError(res: any, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = (error as any)?.status;

  if (status) return res.status(status).json({ error: message });
  throw error;
}

router.use(requireAuth, requireRole('admin', 'super'));

router.get('/knowledge/records', async (req, res, next) => {
  try {
    const result = await listKnowledgeRecords({
      page: req.query.page,
      limit: req.query.limit,
      knowledgeDomain: req.query.knowledgeDomain as string | undefined,
      knowledgeType: req.query.knowledgeType as string | undefined,
      version: req.query.version,
      sourceType: req.query.sourceType as string | undefined,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/records/:id', async (req, res, next) => {
  try {
    const record = await getKnowledgeRecord(String(req.params.id));
    res.json(record);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/registry', async (req, res, next) => {
  try {
    const result = await listKnowledgeRegistry({
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/collections', async (req, res, next) => {
  try {
    const result = await listKnowledgeCollections({
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/collections/:id', async (req, res, next) => {
  try {
    const collection = await getKnowledgeCollection(String(req.params.id));
    res.json(collection);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/knowledge/collections', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const collection = await createKnowledgeCollection({
      collectionType: req.body?.collectionType,
      title: req.body?.title,
      description: req.body?.description,
      knowledgeRecords: req.body?.knowledgeRecords,
      ownerDomain: req.body?.ownerDomain,
      knowledgeSteward: req.body?.knowledgeSteward,
      metadata: req.body?.metadata,
      actorId: user.sub,
    });
    res.status(201).json(collection);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/assets', async (req, res, next) => {
  try {
    const result = await listKnowledgeAssets({
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/assets/:id', async (req, res, next) => {
  try {
    const asset = await getKnowledgeAsset(String(req.params.id));
    res.json(asset);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/metrics', async (_req, res, next) => {
  try {
    const metrics = await getKnowledgeManagementMetrics();
    res.json(metrics);
  } catch (error) {
    return next(error);
  }
});

router.get('/knowledge/utilization', async (_req, res, next) => {
  try {
    const metrics = await getKnowledgeUtilizationMetrics();
    res.json(metrics);
  } catch (error) {
    return next(error);
  }
});

router.post('/knowledge/resolve', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await resolveKnowledge({
      consumer: req.body?.consumer,
      policy: req.body?.policy,
      domain: req.body?.domain,
      objective: req.body?.objective,
      constraints: req.body?.constraints,
      requestedKnowledge: req.body?.requestedKnowledge,
      tenantId: req.body?.tenantId || 'default',
      actorId: user.sub,
    });
    res.status(201).json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/packages/:id', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const pkg = await getKnowledgeUtilizationPackage(String(req.params.id), user.sub);
    res.json(pkg);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/snapshots/:id', async (req, res, next) => {
  try {
    const snapshot = await getKnowledgeSnapshot(String(req.params.id));
    res.json(snapshot);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/validations', async (req, res, next) => {
  try {
    res.json(await listValidations({ page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/validations/:id', async (req, res, next) => {
  try {
    res.json(await getValidation(String(req.params.id)));
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/knowledge/validate', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const result = await validateKnowledge({
      packageId: req.body?.packageId,
      snapshotId: req.body?.snapshotId,
      outcomeId: req.body?.outcomeId,
      validationLevel: req.body?.validationLevel,
      validationMethod: req.body?.validationMethod,
      validatedBy: user.sub,
      actorId: user.sub,
      policy: req.body?.policy,
    });
    res.status(201).json(result);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/outcomes', async (req, res, next) => {
  try {
    res.json(await listOutcomeRegistry({ page: req.query.page, limit: req.query.limit }));
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/outcomes/:id', async (req, res, next) => {
  try {
    res.json(await getOutcome(String(req.params.id)));
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/knowledge/outcomes', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const outcome = await registerOutcome({
      tenantId: req.body?.tenantId,
      outcomeType: req.body?.outcomeType,
      sourceDomain: req.body?.sourceDomain,
      sourceId: req.body?.sourceId,
      businessOutcome: req.body?.businessOutcome,
      operationalOutcome: req.body?.operationalOutcome,
      knowledgeOutcome: req.body?.knowledgeOutcome,
      metadata: req.body?.metadata,
      actorId: user.sub,
    });
    res.status(201).json(outcome);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.get('/knowledge/drift', async (_req, res, next) => {
  try {
    res.json(await listDrift());
  } catch (error) {
    return next(error);
  }
});

router.get('/knowledge/history/:id', async (req, res, next) => {
  try {
    res.json(await getValidationHistory(String(req.params.id)));
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/knowledge/records', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const record = await createKnowledgeRecord({
      knowledgeDomain: req.body?.knowledgeDomain,
      knowledgeType: req.body?.knowledgeType,
      sourceType: req.body?.sourceType,
      sourceId: req.body?.sourceId ?? null,
      facts: req.body?.facts,
      context: req.body?.context,
      provenance: req.body?.provenance,
      producer: req.body?.producer,
      actorId: user.sub,
    });
    res.status(201).json(record);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

router.post('/knowledge/records/:id/version', async (req, res, next) => {
  try {
    const user = (req as any).user;
    const record = await createKnowledgeRecordVersion({
      previousRecordId: String(req.params.id),
      changes: req.body?.changes || {},
      actorId: user.sub,
    });
    res.status(201).json(record);
  } catch (error) {
    try {
      return handleKnowledgeError(res, error);
    } catch (nextError) {
      return next(nextError);
    }
  }
});

export default router;
