import { Router } from 'express';
import type { ChatService } from '../services/chatService.js';
import type { ReadinessProbe } from '../controllers/healthController.js';
import { createChatController } from '../controllers/chatController.js';

export function createChatRouter(service: ChatService, readiness: ReadinessProbe) {
  const router = Router();
  const controller = createChatController(service, readiness);
  router.post('/send/stream', controller.sendStream);
  router.post('/send', controller.send);
  router.get('/history', controller.history);
  return router;
}
