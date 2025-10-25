import mongoose from 'mongoose';
import { env } from './env';

export async function connectDB() {
  if (!env.mongoUri) {
    console.warn('MONGODB_URI vacío. Conecta Atlas y llena .env antes de usar la DB.');
    return;
  }
  await mongoose.connect(env.mongoUri);
  console.log('✅ MongoDB conectado');
}
