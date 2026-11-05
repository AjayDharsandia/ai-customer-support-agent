import jwt from 'jsonwebtoken';
import { AppError } from '../errors/AppError.js';

const ISSUER = 'customer-support-api';
const AUDIENCE = 'customer-support-web';

export function issueToken(userId: string, secret: string, lifetimeSeconds: number) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + lifetimeSeconds;
  const token = jwt.sign({ iat: now, exp }, secret, {
    algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, subject: userId,
  });
  return { token, expiresAt: new Date(exp * 1000).toISOString() };
}
export function verifyToken(token: string, secret: string): Readonly<{ userId: string }> {
  try {
    const claims = jwt.verify(token, secret, {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
    });
    const now = Math.floor(Date.now() / 1000);
    if (
      typeof claims === 'string' ||
      typeof claims.sub !== 'string' || !/^[a-fA-F0-9]{24}$/.test(claims.sub) ||
      claims.iss !== ISSUER || claims.aud !== AUDIENCE ||
      !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) ||
      claims.iat === undefined || claims.exp === undefined ||
      claims.iat > now || claims.exp <= now || claims.exp <= claims.iat
    ) throw new Error('Invalid claims.');
    return Object.freeze({ userId: claims.sub.toLowerCase() });
  } catch {
    throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
  }
}
