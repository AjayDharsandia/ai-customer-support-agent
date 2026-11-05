import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { AuthServerConfig } from './routes/authRoutes.js';
import type { ReadinessProbe } from './controllers/healthController.js';
import type { UserModel } from './models/User.js';
import { AppError } from './errors/AppError.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/authenticate.js';
import { createHealthRouter } from './routes/healthRoutes.js';
import { createAuthRouter } from './routes/authRoutes.js';

import type { ChatService } from './services/chatService.js';
import { createChatRouter } from './routes/chatRoutes.js';

interface AppOptions {
  chat?: ChatService;
  config: AuthServerConfig;
  users: UserModel;
  readiness?: ReadinessProbe;
}
export function createApp({ config, users, chat, readiness = () => ({
  databaseConnected: false, indexesInitialized: false,
}) }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({
    origin: (origin, callback) => callback(null, origin !== undefined && config.clientOrigins.includes(origin)),
    methods: ['GET', 'POST', 'OPTIONS'], allowedHeaders: ['Authorization', 'Content-Type', 'X-CSRF-Protection'], credentials: true,
  }));
  app.use((_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '16kb', inflate: false }));
  app.use(createHealthRouter(readiness));
  app.use('/auth', createAuthRouter(users, config, readiness));
  // Authentication always precedes chat route validation and database/provider access.
  app.use('/chat', authenticate(config.jwtSecret));
  if (chat) app.use('/chat', createChatRouter(chat, readiness));
  app.use((_request, _response, next) => next(new AppError(404, 'NOT_FOUND', 'The requested endpoint does not exist.')));
  app.use(errorHandler);
  return app;
}
