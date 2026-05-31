import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import * as ctrl from '../controllers/sales.controller';

const r = Router();

r.post('/sales/:id/confirm', requireAuth, ctrl.confirmSale);
r.post('/sales/:id/cancel', requireAuth, ctrl.cancelSale);

export default r;
