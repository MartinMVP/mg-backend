import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { randomUUID } from 'crypto';
import { User } from '../../domain/users/user.model';
import { Session } from '../../domain/sessions/session.model';
import { env } from '../../config/env';
import { generateCsrfToken } from '../middlewares/csrf';

function signAccess(sub: string, role: string) {
  return jwt.sign(
    { sub, role, typ: 'access' },
    env.jwtAccessSecret,
    { expiresIn: env.accessTtl }
  );
}

function signRefresh(sub: string, role: string, jti: string) {
  return jwt.sign(
    { sub, role, typ: 'refresh', jti },
    env.jwtRefreshSecret,
    { expiresIn: env.refreshTtl }
  );
}

function setRefreshCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl);
  res.cookie('mg_refresh', token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs
  });
}

function setCsrfCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl);
  res.cookie('mg_csrf', token, {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs
  });
}

export async function register(req: Request, res: Response) {
  const { email, password, name } = req.body;
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, password: hash, name, role: 'user' });

  res.status(201).json({ id: user._id, email: user.email, name: user.name });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const access = signAccess(String(user._id), user.role);
  const jti = randomUUID();
  const refresh = signRefresh(String(user._id), user.role, jti);

  setRefreshCookie(res, refresh);
  setCsrfCookie(res, generateCsrfToken());

  const tokenHash = await bcrypt.hash(refresh, 10);
  const exp = new Date(Date.now() + ms(env.refreshTtl));

  await Session.create({
    user: user._id,
    jti,
    tokenHash,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    expiresAt: exp
  });

  res.json({ access });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.mg_refresh;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret) as any;
    if (payload.typ !== 'refresh' || !payload.jti)
      return res.status(401).json({ error: 'Invalid refresh' });

    const session = await Session.findOne({
      user: payload.sub,
      jti: payload.jti,
      isRevoked: false
    });
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const match = await bcrypt.compare(token, session.tokenHash);
    if (!match) return res.status(401).json({ error: 'Invalid session' });

    // Rotación estricta: revocar actual y emitir nueva
    session.isRevoked = true;
    await session.save();

    const access = signAccess(payload.sub, payload.role);
    const nextJti = randomUUID();
    const nextRefresh = signRefresh(payload.sub, payload.role, nextJti);

    setRefreshCookie(res, nextRefresh);
    setCsrfCookie(res, generateCsrfToken());

    const tokenHash = await bcrypt.hash(nextRefresh, 10);
    const exp = new Date(Date.now() + ms(env.refreshTtl));

    await Session.create({
      user: payload.sub,
      jti: nextJti,
      tokenHash,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      expiresAt: exp
    });

    res.json({ access });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh' });
  }
}

export async function logout(req: Request, res: Response) {
  const user = (req as any).user;
  await Session.updateMany({ user: user.sub, isRevoked: false }, { isRevoked: true });

  res.clearCookie('mg_refresh');
  res.clearCookie('mg_csrf');

  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await User.findById(user.sub).select('email name role createdAt');
  res.json(doc);
}
