import type { CookieOptions, Request, RequestHandler, Response } from 'express';
import type { AuthConfig } from '../config/auth.js';
import { AppError } from '../errors/AppError.js';

export function cookieSecurity(origins: string[]): RequestHandler {
  return (request, _response, next) => {
    const origin = request.get('Origin');
    if (!origin || !origins.includes(origin) || request.get('X-CSRF-Protection') !== '1' ||
      request.get('Sec-Fetch-Site') === 'cross-site') {
      throw new AppError(403, 'CSRF_REJECTED', 'The request origin could not be verified.');
    }
    next();
  };
}
export function refreshCookie(config: AuthConfig) {
  const name = config.cookieMode === 'secure' ? '__Host-csa-refresh' : 'csa-refresh-local';
  const legacyName = config.cookieMode === 'secure' ? '__Host-virallens-refresh' : 'virallens-refresh-local';
  const options: CookieOptions = { httpOnly: true, secure: config.cookieMode === 'secure', sameSite: 'lax', path: '/' };
  return {
    read(request: Request): string | undefined {
      const parts = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
      const matches = parts.filter((part) => part.startsWith(name + '='));
      if (matches.length === 1) return matches[0]!.slice(name.length + 1);
      const legacyMatches = parts.filter((part) => part.startsWith(legacyName + '='));
      if (legacyMatches.length === 1) return legacyMatches[0]!.slice(legacyName.length + 1);
      return undefined;
    },
    set(response: Response, token: string, expiresAt: Date) {
      response.cookie(name, token, { ...options, maxAge: Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000)) * 1000 });
    },
    clear(response: Response) {
      response.clearCookie(name, options);
      response.clearCookie(legacyName, options);
    },
  };
}
