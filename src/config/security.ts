import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './env';

export function securityMiddleware(app: any) {
  // Helmet (CSP + HSTS)
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

  // --- CORS manual, a prueba de errores de encabezado ---
  const allowlist = env.corsOrigin; // p.ej: ['https://mg-frontend.onrender.com','http://localhost:5173']

  app.use((req, res, next) => {
    const origin = req.headers.origin as string | undefined;

    // Quitamos cualquier valor previo por si algo lo setea antes
    res.removeHeader('Access-Control-Allow-Origin');

    if (origin && allowlist.some(o => origin.startsWith(o))) {
      // Reflejamos SOLO el origen que llegó (un string válido, nunca lista)
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    }

    // Respuesta inmediata para preflight
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }

    next();
  });
}
