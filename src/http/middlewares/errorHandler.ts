import { Request, Response, NextFunction } from 'express';

// Middleware de manejo de errores global
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const status = err.status || err.statusCode || 500;
  const isProd = process.env.NODE_ENV === 'production';

  // Mensajes más claros para casos comunes
  const knownMessages = new Set([
    'Not allowed by CORS',
    'CSRF token missing or invalid',
    'CSRF origin blocked',
    'Too Many Attempts. Try later.',
    'Invalid credentials',
    'Invalid refresh',
    'Session not found',
    'Invalid session',
    'No refresh token',
    'No autenticado',
    'No autorizado',
  ]);

  const message =
    (typeof err === 'string' && err) ||
    err.message ||
    (status === 404 ? 'Not Found' : 'Internal Server Error');

  const payload: Record<string, any> = {
    error: knownMessages.has(message) ? message : status === 500 ? 'Server Error' : message,
  };

  if (!isProd) {
    payload.stack = err.stack;
    if (err.cause) payload.cause = err.cause;
  }

  res.status(status).json(payload);
}
