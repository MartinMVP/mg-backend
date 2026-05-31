// src/app.ts
import express from 'express';
import morgan from 'morgan';
import path from 'path';
import fs from 'fs';
import basicAuth from 'basic-auth';

import catalogRoutes from './http/routes/catalog.routes';
import mediaRoutes from './http/routes/media.routes';
import auctionsRoutes from './http/routes/auctions.routes';
import notificationsRoutes from './http/routes/notifications.routes';

import { securityMiddleware } from './config/security';
import authRoutes from './http/routes/auth.routes';
import healthRoutes from './http/routes/health.routes';
import { errorHandler } from './http/middlewares/errorHandler';
import { env } from './config/env';

// Swagger deps
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

const app = express();
app.use(express.json());
app.use(morgan('dev'));
securityMiddleware(app);

// Rutas de la app
app.use('/health', healthRoutes);
app.use('/auth', authRoutes);

// ...
app.use('/files', express.static('uploads', { maxAge: '1d', immutable: true }));
app.use('/catalog', catalogRoutes);
app.use('/api', mediaRoutes); // si lo prefieres en /api
app.use('/', auctionsRoutes);
app.use('/', notificationsRoutes);


/** ---------- Swagger (opcional/protegido) ---------- */
if (env.swaggerEnabled) {
  // Cargamos el YAML desde varias ubicaciones (dev y prod)
  const candidates = [
    path.resolve(__dirname, 'docs', 'openapi.yaml'),          // dist/docs en prod
    path.resolve(process.cwd(), 'dist', 'docs', 'openapi.yaml'),
    path.resolve(process.cwd(), 'src', 'docs', 'openapi.yaml') // dev
  ];

  let swaggerDoc: any | null = null;
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        swaggerDoc = YAML.load(p);
        console.log('📘 Swagger habilitado en', env.swaggerRoute, '(', p, ')');
        break;
      } catch (e) {
        console.warn('⚠️ Error cargando OpenAPI en', p, e);
      }
    }
  }
  if (!swaggerDoc) {
    console.warn('⚠️ No se encontró openapi.yaml en:', candidates);
  } else {
    // Si estamos en producción, requerimos Basic Auth
    const guards: any[] = [];
    if (env.nodeEnv === 'production') {
      guards.push((req: express.Request, res: express.Response, next: express.NextFunction) => {
        const creds = basicAuth(req);
        if (!creds || creds.name !== process.env.SWAGGER_USER || creds.pass !== process.env.SWAGGER_PASS) {
          res.set('WWW-Authenticate', 'Basic realm="docs"');
          return res.status(401).end('Access denied');
        }
        next();
      });
    }
    app.use(env.swaggerRoute, ...guards, swaggerUi.serve, swaggerUi.setup(swaggerDoc));
  }
}
/** ---------- Fin Swagger ---------- */

// manejador de errores al final
app.use(errorHandler);

export default app;
