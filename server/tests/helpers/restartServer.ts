import { loadServerConfig } from '../../src/config/env.js';
import { createDatabase } from '../../src/database/database.js';
import { createApp } from '../../src/app.js';
import { createOpenRouter } from '../../src/services/openRouter.js';
import { createChatService } from '../../src/services/chatService.js';
import { mockProvider } from './mockProvider.js';

async function start() {
  if (process.env.NODE_ENV !== 'test') throw new Error('Test mode is required.');
  const config = loadServerConfig(); // Enforces dedicated MONGODB_TEST_URI before connecting.
  const db = createDatabase(config.databaseUri);
  const provider = createOpenRouter(config);
  mockProvider(provider.client).onPost().reply(200, { choices: [{ message: { content: 'Restart fixture reply' } }] });
  await db.initialize();
  const app = createApp({ config, users: db.users, readiness: db.readiness,
    chat: createChatService(db.conversations, provider.generateReply, provider.generateReplyStream) });
  const server = app.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (address && typeof address !== 'string') process.send?.({ port: address.port });
  });
  process.once('message', () => {
    server.close(() => { void db.close().then(() => process.exit(0)).catch(() => process.exit(1)); });
  });
}
void start().catch(() => { console.error('Isolated test server startup failed; details withheld.'); process.exit(1); });
