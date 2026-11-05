import { once } from 'node:events';
import type { Request, RequestHandler } from 'express';
import type { ReadinessProbe } from './healthController.js';
import type { ChatService } from '../services/chatService.js';
import { parseSendInput, parseHistoryQuery } from '../validation/chat.js';
import { AppError } from '../errors/AppError.js';
import { normalizeError } from '../middleware/errorHandler.js';
import { StreamAbortedError } from '../services/openRouter.js';

function owner(request: Request, readiness: ReadinessProbe): string {
  if (!request.auth) throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
  const state = readiness();
  if (!state.databaseConnected || !state.indexesInitialized) {
    throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.');
  }
  return request.auth.userId;
}
export function createChatController(service: ChatService, readiness: ReadinessProbe) {
  const send: RequestHandler = async (request, response) => {
    if (!request.is('application/json') || Object.keys(request.query).length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Send a JSON body without query parameters.');
    }
    const input = parseSendInput(request.body);
    const data = await service.send(owner(request, readiness), input);
    response.status(200).json({ success: true, data });
  };
  const sendStream: RequestHandler = async (request, response) => {
    if (!request.is('application/json') || Object.keys(request.query).length > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Send a JSON body without query parameters.');
    }
    const input = parseSendInput(request.body);
    // Preparing performs ownership/capacity checks before committing SSE headers or contacting OpenRouter.
    const operation = await service.stream(owner(request, readiness), input);
    const disconnected = new AbortController();
    const abort = () => disconnected.abort();
    request.once('aborted', abort);
    response.once('close', abort);
    response.status(200);
    response.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    const write = async (event: string, data: unknown) => {
      if (disconnected.signal.aborted || response.destroyed) throw new StreamAbortedError();
      if (!response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) {
        await Promise.race([
          once(response, 'drain'),
          once(disconnected.signal, 'abort').then(() => { throw new StreamAbortedError(); }),
        ]);
      }
    };
    try {
      await write('started', { conversationId: operation.existingConversationId });
      const data = await operation.run((text) => write('delta', { text }), disconnected.signal);
      await write('committed', data);
      response.end();
    } catch (error: unknown) {
      if (disconnected.signal.aborted || error instanceof StreamAbortedError) return;
      const normalized = normalizeError(error);
      const outcome = normalized.code === 'DATABASE_UNAVAILABLE' || normalized.code === 'INTERNAL_ERROR'
        ? 'unknown' : 'not_saved';
      try {
        await write('error', { code: normalized.code, message: normalized.message, outcome });
        response.end();
      } catch (writeError: unknown) {
        if (!(writeError instanceof StreamAbortedError)) throw writeError;
      }
    } finally {
      request.off('aborted', abort);
      response.off('close', abort);
    }
  };
  const history: RequestHandler = async (request, response) => {
    if (Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined) {
      throw new AppError(400, 'VALIDATION_ERROR', 'History requests accept no body.');
    }
    const query = parseHistoryQuery(request.query);
    const data = await service.history(owner(request, readiness), query);
    response.status(200).json({ success: true, data });
  };
  return { send, sendStream, history };
}
