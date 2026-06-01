import 'dotenv/config';

export function parseBool(v: string | undefined, def = false) {
  if (v === undefined) return def;
  return ['1','true','yes','on'].includes(String(v).toLowerCase());
}

export function parseCsv(v: string | undefined): string[] {
  if (!v) return [];
  return v.split(/[;,]/).map(s => s.trim()).filter(Boolean);
}

function readRequiredEnv(source: NodeJS.ProcessEnv, key: string, nodeEnv: string) {
  const value = source[key]?.trim();

  if (!value && nodeEnv === 'production') {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value ?? '';
}

export function createEnv(source: NodeJS.ProcessEnv = process.env) {
  const nodeEnv = source.NODE_ENV ?? 'development';

  return {
    nodeEnv,
    port: Number(source.PORT ?? 8080),

    mongoUri: readRequiredEnv(source, 'MONGODB_URI', nodeEnv),

    // JWT (ya los tenías)
    jwtAccessSecret: readRequiredEnv(source, 'JWT_ACCESS_SECRET', nodeEnv),
    jwtRefreshSecret: readRequiredEnv(source, 'JWT_REFRESH_SECRET', nodeEnv),

    // TTLs (el hardening usa ms("<duración>"))
    accessTtl: source.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: source.JWT_REFRESH_TTL ?? '7d',

    // CORS y cookies
    corsOrigin: parseCsv(source.CORS_ORIGIN), // lista de orígenes permitidos
    cookieSecure: parseBool(source.COOKIE_SECURE, false),

    // Swagger
    swaggerEnabled: parseBool(source.SWAGGER_ENABLED, true),
    swaggerRoute: source.SWAGGER_ROUTE ?? '/docs',
  };
}

export const env = createEnv();
