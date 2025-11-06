import { Router } from 'express';
import * as ctrl from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/auth';
import { rateLimitLogin } from '../middlewares/rateLimitLogin';
import { requireCsrf } from '../middlewares/csrf';

const r = Router();

// Registro (público)
r.post('/register', ctrl.register);

// Login con rate limit (IP+email)
r.post('/login', rateLimitLogin, ctrl.login);

// Refresh usa cookie httpOnly => exige CSRF (double submit)
r.post('/refresh', requireCsrf, ctrl.refresh);

// Logout requiere estar autenticado + CSRF
r.post('/logout', requireAuth, requireCsrf, ctrl.logout);

// Perfil actual (requiere autenticación)
r.get('/me', requireAuth, ctrl.me);

// ************ DEBUG TEMPORAL (quitar al final) ************
r.get('/_debug/login', ctrl.debugLogin);
// ***********************************************************

export default r;
