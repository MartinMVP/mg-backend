import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { User } from '../../domain/users/user.model';
import { signAccessToken, signRefreshToken, verifyRefresh } from '../../utils/jwt';

const REFRESH_COOKIE = 'mg_refresh';

export async function register(req: Request, res: Response) {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ message: 'Faltan campos' });

  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ message: 'Email ya registrado' });

  const user = await User.create({ name, email, password });
  res.status(201).json({ id: user._id, email: user.email, name: user.name });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ message: 'Credenciales inválidas' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ message: 'Credenciales inválidas' });

  const access = signAccessToken({ sub: user._id, role: user.role });
  const refresh = signRefreshToken({ sub: user._id });

  // cookie httpOnly para refresh
  res.cookie(REFRESH_COOKIE, refresh, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false, // en prod true
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  res.json({ access, user: { id: user._id, email: user.email, name: user.name, role: user.role } });
}

export async function me(req: any, res: Response) {
  res.json({ user: req.user });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.[REFRESH_COOKIE];
  if (!token) return res.status(401).json({ message: 'Sin refresh' });
  try {
    const payload = verifyRefresh(token) as any;
    const access = signAccessToken({ sub: payload.sub });
    res.json({ access });
  } catch {
    res.status(401).json({ message: 'Refresh inválido' });
  }
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(REFRESH_COOKIE);
  res.json({ ok: true });
}
