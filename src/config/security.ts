// src/config/security.ts
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { env } from './env';

export function securityMiddleware(app: any) {
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

  // ⚠️ Forzamos un único valor de ACAO devolviendo un string, nunca boolean
  const allowlist = env.corsOrigin; // array: ['https://frontend', 'http://localhost:5173']

  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Postman/cURL (sin Origin)
      const match = allowlist.find(o => origin.startsWith(o));
      if (match) {
        // devolvemos el string exacto; CORS lo usará como Access-Control-Allow-Origin
        return cb(null, match as any);
      }
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  }));
}
