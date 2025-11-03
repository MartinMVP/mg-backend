import 'dotenv/config';

function parseBool(v: string | undefined, def = false) {
  if (v === undefined) return def;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}

function parseCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8080),

  mongoUri: process.env.MONGODB_URI ?? '',

  // JWT (ya los tenías)
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET ?? '',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET ?? '',

  // TTLs (el hardening usa ms("<duración>"))
  accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
  refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',

  // CORS y cookies
  corsOrigin: parseCsv(process.env.CORS_ORIGIN), // lista de orígenes permitidos
  cookieSecure: parseBool(process.env.COOKIE_SECURE, false),

  // Swagger
  swaggerEnabled: parseBool(process.env.SWAGGER_ENABLED, true),
  swaggerRoute: process.env.SWAGGER_ROUTE ?? '/docs',
};
