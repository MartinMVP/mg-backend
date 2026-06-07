import { Router } from 'express';
import {
  adminControlCenterAuditActions,
  getAdminControlCenterActivity,
  getAdminControlCenterAlerts,
  getAdminControlCenterDashboard,
  normalizeAdminLimit,
} from '../../domain/admin/adminControlCenter.service';
import { Audit } from '../../domain/audit/audit.model';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

router.use(requireAuth, requireRole('admin', 'super'));

async function recordView(req: any, action: string) {
  await Audit.create({
    actor: req.user?.sub,
    action,
  });
}

router.get('/control-center/dashboard', async (req, res, next) => {
  try {
    const dashboard = await getAdminControlCenterDashboard();
    await recordView(req, adminControlCenterAuditActions.dashboardViewed);
    return res.json(dashboard);
  } catch (error) {
    return next(error);
  }
});

router.get('/control-center/activity', async (req, res, next) => {
  try {
    const activity = await getAdminControlCenterActivity(normalizeAdminLimit(req.query.limit));
    await recordView(req, adminControlCenterAuditActions.activityViewed);
    return res.json({ generatedAt: new Date().toISOString(), activity });
  } catch (error) {
    return next(error);
  }
});

router.get('/control-center/alerts', async (req, res, next) => {
  try {
    const alerts = await getAdminControlCenterAlerts(normalizeAdminLimit(req.query.limit));
    await recordView(req, adminControlCenterAuditActions.alertsViewed);
    return res.json({ generatedAt: new Date().toISOString(), alerts });
  } catch (error) {
    return next(error);
  }
});

export default router;
