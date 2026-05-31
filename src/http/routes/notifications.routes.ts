import { Router } from 'express';
import { requireAuth } from '../middlewares/auth';
import * as ctrl from '../controllers/notifications.controller';

const r = Router();

r.get('/notifications', requireAuth, ctrl.listNotifications);
r.post('/notifications/:id/read', requireAuth, ctrl.markNotificationRead);

export default r;
