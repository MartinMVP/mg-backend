// src/http/controllers/auth.controller.ts
import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import ms from 'ms';
import { randomUUID } from 'crypto';

import { env } from '../../config/env';
import { User } from '../../domain/users/user.model';
import { Session } from '../../domain/sessions/session.model';
import { Audit } from '../../domain/audit/audit.model';
import { generateCsrfToken } from '../middlewares/csrf';

type AccessPayload = { sub: string; role: string; typ: 'access' };
type RefreshPayload = { sub: string; role: string; typ: 'refresh'; jti: string };

function signAccess(sub: string, role: string) {
  // Usa env.jwtAccessSecret y env.accessTtl (string tipo "15m")
  return jwt.sign({ sub, role, typ: 'access' } as AccessPayload, env.jwtAccessSecret, {
    expiresIn: env.accessTtl,
  });
}

function signRefresh(sub: string, role: string, jti: string) {
  return jwt.sign({ sub, role, typ: 'refresh', jti } as RefreshPayload, env.jwtRefreshSecret, {
    expiresIn: env.refreshTtl,
  });
}

function setRefreshCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl); // "7d" -> número (ms)
  res.cookie('mg_refresh', token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs,
  });
}

function setCsrfCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl);
  res.cookie('mg_csrf', token, {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs,
  });
}

// ---------- handlers ----------
export async function register(req: Request, res: Response) {
  const { email, password, name } = req.body || {};
  const exists = await User.findOne({ email });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const user = await User.create({ email, password: hash, name, role: 'user' });
  await Audit.create({ actor: String(user._id), action: 'REGISTER', ip: req.ip, userAgent: req.headers['user-agent'] });

  res.status(201).json({ id: user._id, email: user.email, name: user.name });
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email, isActive: true });
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
  await Session.create({ user: user._id, jti, tokenHash, ip: req.ip, userAgent: req.headers['user-agent'], expiresAt: exp });
  await Audit.create({ actor: String(user._id), action: 'LOGIN', ip: req.ip, userAgent: req.headers['user-agent'] });

  res.json({ access });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.mg_refresh;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret) as RefreshPayload;
    if (payload.typ !== 'refresh' || !payload.jti) return res.status(401).json({ error: 'Invalid refresh' });

    const session = await Session.findOne({ user: payload.sub, jti: payload.jti, isRevoked: false });
    if (!session) return res.status(401).json({ error: 'Session not found' });
    const match = await bcrypt.compare(token, session.tokenHash);
    if (!match) return res.status(401).json({ error: 'Invalid session' });

    // Rotación: revoca actual y crea nueva
    session.isRevoked = true;
    await session.save();

    const access = signAccess(payload.sub, payload.role);
    const nextJti = randomUUID();
    const nextRefresh = signRefresh(payload.sub, payload.role, nextJti);
    setRefreshCookie(res, nextRefresh);
    setCsrfCookie(res, generateCsrfToken());

    const tokenHash = await bcrypt.hash(nextRefresh, 10);
    const exp = new Date(Date.now() + ms(env.refreshTtl));
    await Session.create({ user: payload.sub, jti: nextJti, tokenHash, ip: req.ip, userAgent: req.headers['user-agent'], expiresAt: exp });
    await Audit.create({ actor: String(payload.sub), action: 'REFRESH', ip: req.ip, userAgent: req.headers['user-agent'] });

    res.json({ access });
  } catch {
    return res.status(401).json({ error: 'Invalid refresh' });
  }
}

export async function logout(req: Request, res: Response) {
  const user = (req as any).user; // viene del middleware requireAuth
  await Session.updateMany({ user: user.sub, isRevoked: false }, { isRevoked: true });
  res.clearCookie('mg_refresh');
  res.clearCookie('mg_csrf');
  await Audit.create({ actor: String(user.sub), action: 'LOGOUT', ip: req.ip, userAgent: req.headers['user-agent'] });
  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await User.findById(user.sub).select('email name role isActive createdAt');
  res.json({ user: doc });
}
