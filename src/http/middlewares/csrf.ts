import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { parseCsv } from '../../config/env';


export function generateCsrfToken() {
return crypto.randomBytes(24).toString('base64url');
}

export function getCsrfAllowedOrigins(source: NodeJS.ProcessEnv = process.env) {
return parseCsv(source.CORS_ORIGIN);
}

export function isAllowedCsrfOrigin(value: string | undefined, allowedOrigins: string[], isReferer = false) {
if (!value) return true;

try {
const origin = isReferer ? new URL(value).origin : value;
return allowedOrigins.includes(origin);
} catch {
return false;
}
}

export function requireCsrf(req: Request, res: Response, next: NextFunction) {
// Double submit: cookie + header
const cookieToken = req.cookies?.mg_csrf;
const headerToken = req.headers['x-csrf'];
const origin = req.headers.origin;
const referer = req.headers.referer;


// Origen/Referer básico para producción (ajustar dominios)
const allowed = getCsrfAllowedOrigins();
const okOrigin = isAllowedCsrfOrigin(origin, allowed);
const okReferer = isAllowedCsrfOrigin(referer, allowed, true);


if (!okOrigin || !okReferer) return res.status(403).json({ error: 'CSRF origin blocked' });
if (!cookieToken || typeof headerToken !== 'string' || headerToken !== cookieToken) {
return res.status(403).json({ error: 'CSRF token missing or invalid' });
}
return next();
}
