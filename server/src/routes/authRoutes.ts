import { Router } from 'express';
import { createAuthController } from '../controllers/authController.js';
import { createAuthService } from '../services/authService.js';
import { cookieSecurity } from '../middleware/cookieSecurity.js';
import type { ReadinessProbe } from '../controllers/healthController.js';
import type { UserModel } from '../models/User.js';
import type { ServerConfig } from '../config/env.js';
export type AuthServerConfig = Pick<ServerConfig, 'jwtSecret' | 'clientOrigins' | 'accessSeconds' | 'refreshSeconds' | 'cookieMode'>;
export function createAuthRouter(users: UserModel, config: AuthServerConfig, readiness: ReadinessProbe): Router {
  const service = createAuthService(users, config);
  const router = Router();
  router.use(cookieSecurity(config.clientOrigins));
  for (const action of ['signup', 'login', 'refresh', 'logout'] as const) {
    router.post('/' + action, createAuthController(service, readiness, action, config));
  }
  return router;
}
