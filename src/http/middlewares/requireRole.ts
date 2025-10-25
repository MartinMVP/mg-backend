import { Request, Response, NextFunction } from 'express';

export function requireRole(...roles: Array<'user' | 'admin' | 'super'>) {
  return (req: Request & { user?: any }, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'No autenticado' });
    if (!roles.includes(user.role)) {
      return res.status(403).json({ message: 'No autorizado' });
    }
    next();
  };
}
