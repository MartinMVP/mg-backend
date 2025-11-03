// src/config/security.ts
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env';
import { Request, Response, NextFunction } from 'express';

export function securityMiddleware(app: any) {
  const allowlist = env.corsOrigin; // ['https://mg-frontend.onrender.com','http://localhost:5173']

  // CORS manual: siempre 1 valor de ACAO
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin as string | undefined;

    // Por si alguien lo puso antes
    res.removeHeader('Access-Control-Allow-Origin');

    if (origin && allowlist.some(o => origin.startsWith(o))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }

    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });

  // Seguridad extra
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "img-src": ["'self'", 'data:', 'blob:'],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "connect-src": ["'self'", ...(env.corsOrigin.length ? env.corsOrigin : ['*'])],
      },
    },
    hsts: { maxAge: 15552000, includeSubDomains: true, preload: false },
  }));

  app.use(cookieParser());
}
