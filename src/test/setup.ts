import { afterAll, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongo: MongoMemoryServer;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
  process.env.CORS_ORIGIN = 'http://localhost:5173';
  process.env.COOKIE_SECURE = 'false';
  process.env.SWAGGER_ENABLED = 'false';
  process.env.STRIPE_ENABLED = 'false';
  process.env.STRIPE_ENVIRONMENT = 'sandbox';
  process.env.STRIPE_SECRET_KEY = '';
  process.env.STRIPE_WEBHOOK_SECRET = '';
  process.env.STRIPE_SUCCESS_URL = '';
  process.env.STRIPE_CANCEL_URL = '';

  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;

  await Promise.all(
    Object.values(collections).map((collection) => collection.deleteMany({}))
  );
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongo.stop();
});
