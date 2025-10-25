import 'dotenv/config';

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),
  mongoUri: process.env.MONGODB_URI ?? '',
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
};
