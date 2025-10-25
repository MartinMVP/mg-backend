import { Request, Response, NextFunction } from 'express';
import { verifyAccess } from '../../utils/jwt';
import { User } from '../../domain/users/user.model';

export async function requireAuth(req: Request & { user?: any }, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!token) return res.status(401).json({ message: 'Sin token' });
  try {
    const payload = verifyAccess(token) as any;
    const user = await User.findById(payload.sub).select('_id name email role');
    if (!user) return res.status(401).json({ message: 'Usuario no encontrado' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ message: 'Token inválido' });
  }
}
