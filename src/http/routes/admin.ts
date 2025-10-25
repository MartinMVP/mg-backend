import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

// Solo admin y super
router.get('/ping', requireAuth, requireRole('admin', 'super'), (_req, res) => {
  res.json({ ok: true, area: 'admin', ts: new Date().toISOString() });
});

export default router;
