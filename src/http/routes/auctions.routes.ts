import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import * as ctrl from '../controllers/auctions.controller';

const r = Router();

// públicas
r.get('/auctions', ctrl.listAuctions);
r.get('/auctions/:id', ctrl.getAuction);

// gestión (ajusta requireRole si lo quieres restringir a admin/super)
r.post('/auctions', requireAuth, ctrl.createAuction);
r.post('/auctions/:id/open', requireAuth, ctrl.openAuction);
r.post('/auctions/:id/pause', requireAuth, ctrl.pauseAuction);
r.post('/auctions/:id/resume', requireAuth, ctrl.resumeAuction);
r.post('/auctions/:id/close', requireAuth, ctrl.closeAuction);

// fallback HTTP para pujar
r.post('/auctions/:id/bid', requireAuth, ctrl.placeBidHttp);

export default r;
