import { Request, Response } from 'express';
import * as bcrypt from 'bcryptjs';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import ms, { StringValue as MsStringValue } from 'ms';
import { randomUUID } from 'crypto';
import mongoose from 'mongoose';

import { env } from '../../config/env';
import { User } from '../../domain/users/user.model';
import { Session } from '../../domain/sessions/session.model';
import { Audit } from '../../domain/audit/audit.model';
import { generateCsrfToken } from '../middlewares/csrf';

// payloads
type AccessPayload = { sub: string; role: string; typ: 'access' };
type RefreshPayload = { sub: string; role: string; typ: 'refresh'; jti: string };

// helpers de firmado
function signAccess(sub: string, role: string) {
  const payload: AccessPayload = { sub, role, typ: 'access' };
  const secret: Secret = env.jwtAccessSecret;
  const opts: SignOptions = { expiresIn: env.accessTtl as MsStringValue };
  return jwt.sign(payload, secret, opts);
}

function signRefresh(sub: string, role: string, jti: string) {
  const payload: RefreshPayload = { sub, role, typ: 'refresh', jti };
  const secret: Secret = env.jwtRefreshSecret;
  const opts: SignOptions = { expiresIn: env.refreshTtl as MsStringValue };
  return jwt.sign(payload, secret, opts);
}

function setRefreshCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl as MsStringValue);
  res.cookie('mg_refresh', token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs,
  });
}

function setCsrfCookie(res: Response, token: string) {
  const ttlMs = ms(env.refreshTtl as MsStringValue);
  res.cookie('mg_csrf', token, {
    httpOnly: false,
    secure: env.cookieSecure,
    sameSite: 'lax',
    maxAge: ttlMs,
  });
}

export async function register(req: Request, res: Response) {
  const { email, password, name } = req.body ?? {};
  const normEmail = String(email || '').toLowerCase().trim();

  const exists = await User.findOne({ email: normEmail });
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const user = await User.create({ email: normEmail, password: hash, name, role: 'user' });

  await Audit.create({
    actor: String(user._id),
    action: 'REGISTER',
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string,
  });

  res.status(201).json({ id: user._id, email: user.email, name: user.name });
}

export async function login(req: Request, res: Response) {
  const rawEmail = String(req.body?.email || '');
  const plain = String(req.body?.password || '');
  const email = rawEmail.toLowerCase().trim();

  // ⚠️ tu schema no tiene isActive
  const user = await User.findOne({ email }).select('password role email name');
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(plain, user.password || '');
  if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

  const access = signAccess(String(user._id), user.role);
  const jti = randomUUID();
  const refresh = signRefresh(String(user._id), user.role, jti);

  setRefreshCookie(res, refresh);
  setCsrfCookie(res, generateCsrfToken());

  const tokenHash = await bcrypt.hash(refresh, 10);
  const exp = new Date(Date.now() + ms(env.refreshTtl as MsStringValue));

  await Session.create({
    user: user._id,
    jti,
    tokenHash,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string,
    expiresAt: exp,
  });

  await Audit.create({
    actor: String(user._id),
    action: 'LOGIN',
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string,
  });

  res.json({ access });
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.mg_refresh;
  if (!token) return res.status(401).json({ error: 'No refresh token' });

  try {
    const payload = jwt.verify(token, env.jwtRefreshSecret) as RefreshPayload;
    if (payload.typ !== 'refresh' || !payload.jti)
      return res.status(401).json({ error: 'Invalid refresh' });

    const session = await Session.findOne({ user: payload.sub, jti: payload.jti, isRevoked: false });
    if (!session) return res.status(401).json({ error: 'Session not found' });

    const match = await bcrypt.compare(token, session.tokenHash);
    if (!match) return res.status(401).json({ error: 'Invalid session' });

    // rotación
    session.isRevoked = true;
    await session.save();

    const access = signAccess(payload.sub, payload.role);
    const nextJti = randomUUID();
    const nextRefresh = signRefresh(payload.sub, payload.role, nextJti);

    setRefreshCookie(res, nextRefresh);
    setCsrfCookie(res, generateCsrfToken());

    const tokenHash = await bcrypt.hash(nextRefresh, 10);
    const exp = new Date(Date.now() + ms(env.refreshTtl as MsStringValue));
    await Session.create({
      user: payload.sub,
      jti: nextJti,
      tokenHash,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string,
      expiresAt: exp,
    });

    await Audit.create({
      actor: String(payload.sub),
      action: 'REFRESH',
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string,
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

  await Audit.create({
    actor: String(user.sub),
    action: 'LOGOUT',
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string,
  });

  res.json({ ok: true });
}

export async function me(req: Request, res: Response) {
  const user = (req as any).user;
  const doc = await User.findById(user.sub).select('email name role createdAt');
  res.json({ user: doc });
}

/**
 * Endpoint TEMPORAL de diagnóstico para Render.
 * GET /auth/_debug/login
 * Devuelve si la DB es la correcta y si el hash coincide con "Sup3rP4ss!".
 */
export async function debugLogin(req: Request, res: Response) {
  const email = 'super@mg.mx';
  const plain = 'Sup3rP4ss!';

  const dbName = mongoose.connection?.db?.databaseName;
  const user = await User.findOne({ email }).lean();

  let hasPassword = false;
  let matches: boolean | null = null;

  if (user?.password) {
    hasPassword = true;
    try {
      matches = await bcrypt.compare(plain, user.password);
    } catch {
      matches = null;
    }
  }

  res.json({
    ok: true,
    dbName,
    found: !!user,
    role: (user as any)?.role ?? null,
    hasPassword,
    matches,
  });
}
