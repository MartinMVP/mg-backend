import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';


export function generateCsrfToken() {
return crypto.randomBytes(24).toString('base64url');
}


export function requireCsrf(req: Request, res: Response, next: NextFunction) {
// Double submit: cookie + header
const cookieToken = req.cookies?.mg_csrf;
const headerToken = req.headers['x-csrf'];
const origin = req.headers.origin || '';
const referer = req.headers.referer || '';


// Origen/Referer básico para producción (ajustar dominios)
const allowed = process.env.CORS_ORIGIN?.split(',').map(s=>s.trim()).filter(Boolean) || [];
const okOrigin = !origin || allowed.some(a => origin.startsWith(a));
const okReferer = !referer || allowed.some(a => referer.startsWith(a));


if (!okOrigin || !okReferer) return res.status(403).json({ error: 'CSRF origin blocked' });
if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
return res.status(403).json({ error: 'CSRF token missing or invalid' });
}
return next();
}