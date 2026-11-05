import { Router } from 'express';
import { createHealthController } from '../controllers/healthController.js';
import type { ReadinessProbe } from '../controllers/healthController.js';

export function createHealthRouter(probe: ReadinessProbe): Router {
  const router = Router();
  router.get('/health', createHealthController(probe));
  return router;
}
