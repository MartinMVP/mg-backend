import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import { requireRole } from '../middlewares/requireRole';
import * as ctrl from '../controllers/auctions.controller';

const r = Router();

// públicas
r.get('/auctions', ctrl.listAuctions);
r.get('/auctions/:id', ctrl.getAuction);

// NUEVA RUTA
r.get('/auctions/:id/bids', ctrl.getAuctionBids);

// gestión
r.post('/auctions', requireAuth, requireRole('admin', 'super'), ctrl.createAuction);
r.post('/auctions/:id/open', requireAuth, requireRole('admin', 'super'), ctrl.openAuction);
r.post('/auctions/:id/pause', requireAuth, requireRole('admin', 'super'), ctrl.pauseAuction);
r.post('/auctions/:id/resume', requireAuth, requireRole('admin', 'super'), ctrl.resumeAuction);
r.post('/auctions/:id/close', requireAuth, requireRole('admin', 'super'), ctrl.closeAuction);

// fallback HTTP para pujar
r.post('/auctions/:id/bid', requireAuth, ctrl.placeBidHttp);

export default r;
