import { createRefreshSessionModel } from '../models/RefreshSession.js';
import mongoose from 'mongoose';
import { createUserModel } from '../models/User.js';
import { createConversationModel } from '../models/Conversation.js';
import { AppError } from '../errors/AppError.js';
import type { Readiness } from '../controllers/healthController.js';

export function createDatabase(uri: string) {
  const connection = mongoose.createConnection();
  connection.set('maxTimeMS', 5_000);
  const users = createUserModel(connection);
  const conversations = createConversationModel(connection);
  const refreshSessions = createRefreshSessionModel(connection);
  let indexesInitialized = false;
  let closing = false;
  // Consume driver error events without exposing hostnames, credentials or payloads.
  connection.on('error', () => { console.error(JSON.stringify({ event: 'database_error' })); });

  const readiness = (): Readiness => ({
    databaseConnected: !closing && connection.readyState === 1,
    indexesInitialized: !closing && indexesInitialized,
  });
  async function close(): Promise<void> {
    closing = true;
    indexesInitialized = false;
    await connection.close();
  }
  async function initialize(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const initializeConnection = async () => {
        await connection.openUri(uri, {
          bufferCommands: false, autoIndex: false, autoCreate: false,
          serverSelectionTimeoutMS: 5_000, connectTimeoutMS: 5_000,
          socketTimeoutMS: 5_000,
        });
        if (closing) throw new Error('Initialization cancelled.');
        // Adds required indexes only; never drops collections or existing indexes.
        await Promise.all([users.createIndexes(), conversations.createIndexes(), refreshSessions.createIndexes()]);
        if (closing) throw new Error('Initialization cancelled.');
        indexesInitialized = true;
      };
      await Promise.race([
        initializeConnection(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Initialization timed out.')), 15_000);
        }),
      ]);
    } catch {
      await close().catch(() => undefined);
      throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return { connection, users, conversations, refreshSessions, readiness, initialize, close };
}
export type Database = ReturnType<typeof createDatabase>;
