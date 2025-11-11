import { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../../utils/jwt';
import { User } from '../../domain/users/user.model';

/**
 * Autenticación por:
 *  - Authorization: Bearer <token>
 *  - (fallback) Cookie: mg_access | access
 *
 * Deja en req.user un objeto plano con { sub, role, email, name }
 * para que los controladores puedan usar `user.sub` y `user.role`.
 */
export async function requireAuth(
  req: Request & { user?: any },
  res: Response,
  next: NextFunction
) {
  try {
    // 1) Token desde Authorization: Bearer
    const auth = req.headers.authorization || '';
    const m = auth.match(/^Bearer\s+(.+)$/i);
    let token = m ? m[1] : '';

    // 2) Fallback: cookie httpOnly (si existe)
    if (!token) {
      const cookieAny = (req as any).cookies;
      token = cookieAny?.mg_access || cookieAny?.access || '';
    }

    if (!token) return res.status(401).json({ message: 'Sin token' });

    // 3) Verificar token (usa tu util de Sprint 1)
    const payload = verifyAccess(token) as any; // esperado: { sub, role, typ, ... }

    // 4) Cargar usuario (opcional pero recomendado)
    const dbUser = await User.findById(payload.sub).select('_id name email role');
    if (!dbUser) return res.status(401).json({ message: 'Usuario no encontrado' });

    // Objeto plano compatible con controladores que esperan `user.sub`
    req.user = {
      sub: String(dbUser._id),
      role: dbUser.role,
      email: dbUser.email,
      name: dbUser.name,
      typ: payload.typ,
    };

    return next();
  } catch {
    return res.status(401).json({ message: 'Token inválido' });
  }
}
