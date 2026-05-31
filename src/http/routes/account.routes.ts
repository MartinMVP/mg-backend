import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import * as ctrl from '../controllers/account.controller';

const r = Router();

r.get('/account/purchases', requireAuth, ctrl.listPurchases);
r.get('/account/sales', requireAuth, ctrl.listSales);

export default r;
