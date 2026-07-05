import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import {
  cancelMembershipInvoice,
  getMembershipInvoiceForUser,
  listMembershipFiscalHistory,
  requestMembershipInvoiceFromTransaction,
} from '../../domain/fiscalMembership/fiscalMembership.service';

const router = Router();

router.post('/fiscal/memberships/invoice', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await requestMembershipInvoiceFromTransaction({
    transactionId: String(req.body?.transactionId || ''),
    userId: user.sub,
    metadata: req.body?.metadata,
  });
  res.status(result.status).json(result.body);
});

router.get('/fiscal/memberships/invoice/:id', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const invoice = await getMembershipInvoiceForUser(String(req.params.id), user.sub);
  if (!invoice) return res.status(404).json({ error: 'invoice_not_found' });
  res.json(invoice);
});

router.get('/fiscal/memberships/history', requireAuth, async (req, res) => {
  const user = (req as any).user;
  res.json({ items: await listMembershipFiscalHistory(user.sub) });
});

router.post('/fiscal/memberships/invoice/:id/cancel', requireAuth, async (req, res) => {
  const user = (req as any).user;
  const result = await cancelMembershipInvoice({
    invoiceId: String(req.params.id),
    userId: user.sub,
    reason: String(req.body?.reason || '02'),
    metadata: req.body?.metadata,
  });
  res.status(result.status).json(result.body);
});

export default router;

