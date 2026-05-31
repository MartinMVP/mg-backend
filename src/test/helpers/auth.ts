import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';

type TestRole = 'user' | 'admin' | 'super';

export function createAccessToken(userId: string | Types.ObjectId, role: TestRole = 'user') {
  return jwt.sign(
    {
      sub: String(userId),
      role,
      typ: 'access',
    },
    process.env.JWT_ACCESS_SECRET || 'test-access-secret',
    { expiresIn: '15m' }
  );
}

export function bearer(token: string) {
  return `Bearer ${token}`;
}
