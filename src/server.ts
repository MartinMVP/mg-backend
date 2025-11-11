// src/server.ts
import http from 'http';
import app from './app';
import { env } from './config/env';
import { connectDB } from './config/db';
import { initIO } from './realtime/socket';

const PORT = Number(env.port) || Number(process.env.PORT) || 8080;
const HOST = (process.env.HOST || '0.0.0.0') as string;

app.get('/', (_req, res) => { res.send('Mercado Ganadero API activa 🐄'); });

process.on('uncaughtException', (err) => console.error('❌ UncaughtException:', err));
process.on('unhandledRejection', (r) => console.error('❌ UnhandledRejection:', r));

async function bootstrap() {
  try {
    await connectDB();
    const server = http.createServer(app);
    initIO(server); // 👈 WebSocket listo

    server.listen(PORT, HOST, () => {
      console.log(`🚀 API+WS listo en http://${HOST}:${PORT}`);
    });

    const shutdown = (signal: NodeJS.Signals) => {
      console.log(`\n🔻 ${signal}. Cerrando servidor...`);
      server.close(() => { console.log('✅ Cerrado.'); process.exit(0); });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  } catch (err) {
    console.error('Error al iniciar:', err);
    process.exit(1);
  }
}

bootstrap();

