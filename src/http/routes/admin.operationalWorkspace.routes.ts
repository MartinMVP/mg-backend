import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import {
  archiveListing,
  closeConversation,
  getFiscalWorkspace,
  getNeedsAttention,
  getOperationalDashboard,
  getOperationalQueue,
  listConversations,
  listListings,
  listMemberships,
  listUsers,
  recoverFiscalFromWorkspace,
  suspendUser,
  updateMembership,
} from '../../domain/admin/operationalWorkspace.service';

const router = Router();

router.use(requireAuth, requireRole('admin', 'super'));

function handleWorkspaceError(res: any, error: any) {
  const status = Number(error?.status) || 500;
  return res.status(status).json({ error: error?.message || 'operational_workspace_error' });
}

router.get('/dashboard', async (_req, res) => {
  res.json(await getOperationalDashboard());
});

router.get('/operations/queue', async (req, res) => {
  res.json(await getOperationalQueue(req.query));
});

router.get('/operations/needs-attention', async (req, res) => {
  res.json(await getNeedsAttention(req.query));
});

router.get('/users', async (req, res) => {
  res.json(await listUsers(req.query));
});

router.post('/users/:id/suspend', async (req, res) => {
  try {
    res.json(await suspendUser(req.params.id, (req as any).user.sub));
  } catch (error) {
    handleWorkspaceError(res, error);
  }
});

router.get('/memberships', async (req, res) => {
  res.json(await listMemberships(req.query));
});

router.patch('/memberships/:id', async (req, res) => {
  try {
    res.json(await updateMembership(req.params.id, String(req.body?.status || ''), (req as any).user.sub));
  } catch (error) {
    handleWorkspaceError(res, error);
  }
});

router.get('/listings', async (req, res) => {
  res.json(await listListings(req.query));
});

router.post('/listings/:id/archive', async (req, res) => {
  try {
    res.json(await archiveListing(req.params.id, (req as any).user.sub));
  } catch (error) {
    handleWorkspaceError(res, error);
  }
});

router.get('/conversations', async (req, res) => {
  res.json(await listConversations(req.query));
});

router.post('/conversations/:id/close', async (req, res) => {
  try {
    res.json(await closeConversation(req.params.id, (req as any).user.sub));
  } catch (error) {
    handleWorkspaceError(res, error);
  }
});

router.get('/fiscal', async (req, res) => {
  res.json(await getFiscalWorkspace(req.query));
});

router.post('/fiscal/recover', async (req, res) => {
  res.json(await recoverFiscalFromWorkspace((req as any).user.sub));
});

export default router;
