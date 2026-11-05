import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import { verifyToken } from '../services/tokens.js';

declare module 'express-serve-static-core' {
  interface Request { auth?: Readonly<{ userId: string }> }
}
export function authenticate(secret: string): RequestHandler {
  return (request, _response, next) => {
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([^\s]+)$/i.exec(header) : null;
    if (!match?.[1]) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    request.auth = verifyToken(match[1], secret);
    next();
  };
}
