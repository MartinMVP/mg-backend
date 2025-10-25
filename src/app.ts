// src/app.ts
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import fs from 'fs';
import path from 'path';

import { env } from './config/env';
import healthRouter from './http/routes/health';
import authRouter from './http/routes/auth';
import adminRouter from './http/routes/admin'; // <- añadido

const app = express();

// Middlewares base
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser());
app.use(morgan('dev'));

// Rutas base
app.use('/health', healthRouter);
app.use('/auth', authRouter);
app.use('/admin', adminRouter); // <- añadido

// ---------- Swagger (/docs) ----------
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';

// Buscamos el YAML en varios lugares (build y dev)
const swaggerCandidates = [
  // cuando compila a JS y copiaste docs junto a los .js (dist/docs)
  path.resolve(__dirname, 'docs', 'openapi.yaml'),
  // por si __dirname cambia según cómo arranque el proceso
  path.resolve(process.cwd(), 'dist', 'docs', 'openapi.yaml'),
  // modo desarrollo con ts-node-dev (yaml dentro de src)
  path.resolve(process.cwd(), 'src', 'docs', 'openapi.yaml'),
];

let swaggerLoaded = false;
for (const p of swaggerCandidates) {
  if (fs.existsSync(p)) {
    try {
      const swaggerDoc = YAML.load(p);
      app.use('/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
      console.log('📘 Swagger habilitado en /docs (', p, ')');
      swaggerLoaded = true;
      break;
    } catch (e) {
      console.warn('⚠️ Error cargando OpenAPI en', p, e);
    }
  }
}
if (!swaggerLoaded) {
  console.warn('⚠️ No se encontró openapi.yaml en:', swaggerCandidates);
}

export default app;
