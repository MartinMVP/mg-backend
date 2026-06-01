import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import * as ctrl from '../controllers/account.controller';

const r = Router();

r.get('/account/purchases', requireAuth, ctrl.listPurchases);
r.get('/account/sales', requireAuth, ctrl.listSales);
r.get('/account/fiscal-profile', requireAuth, ctrl.getFiscalProfile);
r.post('/account/fiscal-profile', requireAuth, ctrl.upsertFiscalProfile);

export default r;
