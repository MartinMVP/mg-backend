import app from './app';
import { env } from './config/env';
import { connectDB } from './config/db';

async function bootstrap() {
  await connectDB();
  app.listen(env.port, () => {
    console.log(`🚀 Server listo en http://localhost:${env.port}`);
  });
}

bootstrap().catch((err) => {
  console.error('Error al iniciar:', err);
  process.exit(1);
});
