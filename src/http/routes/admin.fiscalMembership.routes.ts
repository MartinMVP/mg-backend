import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import {
  getAdminMembershipInvoice,
  listAdminMembershipInvoices,
  listFailedMembershipInvoices,
  reprocessMembershipInvoice,
} from '../../domain/fiscalMembership/fiscalMembership.service';
import { listAdminFiscalOperations } from '../../domain/fiscalOperations/fiscalPlatform.service';

const router = Router();

router.use(requireAuth, requireRole('admin', 'super'));

router.get('/fiscal/invoices', async (req, res) => {
  const legacyInvoices = await listAdminMembershipInvoices(req.query);
  const platformInvoices = await listAdminFiscalOperations(req.query);
  if (!platformInvoices.total) return res.json(legacyInvoices);
  const legacyItems = Array.isArray((legacyInvoices as any).items) ? (legacyInvoices as any).items : [];
  res.json({
    ...legacyInvoices,
    items: [...platformInvoices.items, ...legacyItems],
    total: platformInvoices.total + Number((legacyInvoices as any).total || legacyItems.length || 0),
  });
});

router.get('/fiscal/failed', async (_req, res) => {
  res.json({ items: await listFailedMembershipInvoices() });
});

router.get('/fiscal/invoices/:id', async (req, res) => {
  const invoice = await getAdminMembershipInvoice(String(req.params.id));
  if (!invoice) return res.status(404).json({ error: 'invoice_not_found' });
  res.json(invoice);
});

router.post('/fiscal/reprocess/:id', async (req, res) => {
  const result = await reprocessMembershipInvoice(String(req.params.id), req.body?.metadata);
  res.status(result.status).json(result.body);
});

export default router;

