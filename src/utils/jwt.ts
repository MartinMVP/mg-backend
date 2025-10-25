import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function signAccessToken(payload: object) {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: '15m' });
}

export function signRefreshToken(payload: object) {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: '7d' });
}

export function verifyAccess(token: string) {
  return jwt.verify(token, env.jwtAccessSecret) as any;
}

export function verifyRefresh(token: string) {
  return jwt.verify(token, env.jwtRefreshSecret) as any;
}
