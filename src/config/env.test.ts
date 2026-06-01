import { describe, expect, it } from 'vitest';
import { createEnv, parseCsv } from './env';

describe('env config', () => {
  it('throws in production when MONGODB_URI is missing', () => {
    expect(() =>
      createEnv({
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'access-secret',
        JWT_REFRESH_SECRET: 'refresh-secret',
      })
    ).toThrow('Missing required environment variable: MONGODB_URI');
  });

  it('throws in production when JWT_ACCESS_SECRET is missing', () => {
    expect(() =>
      createEnv({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost:27017/mg',
        JWT_REFRESH_SECRET: 'refresh-secret',
      })
    ).toThrow('Missing required environment variable: JWT_ACCESS_SECRET');
  });

  it('throws in production when JWT_REFRESH_SECRET is missing', () => {
    expect(() =>
      createEnv({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://localhost:27017/mg',
        JWT_ACCESS_SECRET: 'access-secret',
      })
    ).toThrow('Missing required environment variable: JWT_REFRESH_SECRET');
  });

  it('parses comma and semicolon separated CORS origins', () => {
    expect(parseCsv('https://mg-frontend.onrender.com; http://localhost:5173,https://beta.mercadoganadero.mx')).toEqual([
      'https://mg-frontend.onrender.com',
      'http://localhost:5173',
      'https://beta.mercadoganadero.mx',
    ]);
  });
});
