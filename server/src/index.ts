import { createApp } from './app.js';
import { ConfigurationError, loadServerConfig } from './config/env.js';
import { createDatabase } from './database/database.js';

import { createOpenRouter } from './services/openRouter.js';
import { createChatService } from './services/chatService.js';

function start(): void {
  let config;
  try { config = loadServerConfig(); }
  catch (error: unknown) {
    console.error(error instanceof ConfigurationError ? error.message : 'Server configuration could not be loaded.');
    process.exitCode = 1;
    return;
  }
  const database = createDatabase(config.databaseUri);
  let stopping = false;
  const provider = createOpenRouter(config);
  const chat = createChatService(database.conversations, provider.generateReply, provider.generateReplyStream);
  const server = createApp({ config, users: database.users, readiness: database.readiness, chat })
    .listen(config.port, '0.0.0.0', () => {
      console.info(JSON.stringify({ event: 'server_listening', port: config.port }));
      void database.initialize().then(() => {
        if (!stopping) console.info(JSON.stringify({ event: 'database_ready' }));
      }).catch(() => {
        console.error(JSON.stringify({ event: 'database_initialization_failed', code: 'DATABASE_UNAVAILABLE' }));
        shutdown(1);
      });
    });
  function shutdown(exitCode = 0): void {
    if (stopping) return;
    stopping = true;
    process.exitCode = exitCode;
    const deadline = setTimeout(() => { server.closeAllConnections(); process.exit(exitCode || 1); }, 5_000);
    deadline.unref();
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    void Promise.all([closed, database.close()]).then(() => {
      clearTimeout(deadline);
      console.info(JSON.stringify({ event: 'server_stopped' }));
    }).catch(() => { process.exitCode = 1; });
  }
  server.on('error', () => { console.error(JSON.stringify({ event: 'server_start_failed' })); shutdown(1); });
  process.once('SIGINT', () => shutdown());
  process.once('SIGTERM', () => shutdown());
}
start();
