import { Router } from 'express';
import { login, me, refresh, register, logout } from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', requireAuth, me);

export default router;
