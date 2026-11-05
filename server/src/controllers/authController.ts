import type { RequestHandler } from 'express';
import type { createAuthService } from '../services/authService.js';
import type { ReadinessProbe } from './healthController.js';
import type { AuthConfig } from '../config/auth.js';
import { refreshCookie } from '../middleware/cookieSecurity.js';
import { parseAuthInput } from '../validation/auth.js';
import { AppError } from '../errors/AppError.js';

export function createAuthController(
  service: ReturnType<typeof createAuthService>, readiness: ReadinessProbe,
  action: 'signup' | 'login' | 'refresh' | 'logout', config: AuthConfig,
): RequestHandler {
  const cookie = refreshCookie(config);
  return async (request, response) => {
    if (!request.is('application/json') || Object.keys(request.query).length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Send a JSON body without query parameters.');
    }
    const input = action === 'signup' || action === 'login' ? parseAuthInput(request.body) : undefined;
    if (!input && (!request.body || Array.isArray(request.body) || typeof request.body !== 'object' || Object.keys(request.body).length)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Send an empty JSON object.');
    }
    const state = readiness();
    if (!state.databaseConnected || !state.indexesInitialized) {
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.');
    }
    const credential = cookie.read(request);
    if (action === 'logout') {
      await service.logout(credential);
      cookie.clear(response);
      response.json({ success: true, data: { loggedOut: true } });
      return;
    }
    // Do not clear cookies on refresh errors: a concurrent winner may have replaced it.
    const result = action === 'refresh' ? await service.refresh(credential) :
      await service[action](input!, credential);
    cookie.set(response, result.refresh.token, result.refresh.expiresAt);
    response.status(action === 'signup' ? 201 : 200).json({ success: true, data: result.data });
  };
}
