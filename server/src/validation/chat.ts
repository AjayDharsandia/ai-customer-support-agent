import { AppError } from '../errors/AppError.js';
import type { SendChatRequest } from '../types/api.js';

function invalid(): never {
  throw new AppError(400, 'VALIDATION_ERROR', 'Please check the request.');
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{24}$/.test(value)) return invalid();
  return value.toLowerCase();
}
export function parseSendInput(value: unknown): SendChatRequest {
  const body = object(value);
  if (Object.keys(body).some((key) => !['message', 'conversationId'].includes(key))) return invalid();
  if (typeof body.message !== 'string') return invalid();
  const message = body.message.trim();
  if (!message || Array.from(message).length > 4000) return invalid();
  return { message, ...('conversationId' in body ? { conversationId: id(body.conversationId) } : {}) };
}
export type HistoryQuery =
  | { mode: 'detail'; conversationId: string }
  | { mode: 'list'; page: number; limit: number; skip: number };
export function parseHistoryQuery(value: unknown): HistoryQuery {
  const query = object(value);
  if (Object.keys(query).some((key) => !['conversationId', 'page', 'limit'].includes(key))) return invalid();
  if ('conversationId' in query) {
    if ('page' in query || 'limit' in query) return invalid();
    return { mode: 'detail', conversationId: id(query.conversationId) };
  }
  const positive = (input: unknown, fallback: number) => {
    if (input === undefined) return fallback;
    if (typeof input !== 'string' || !/^[0-9]+$/.test(input)) return invalid();
    const number = Number(input);
    if (!Number.isSafeInteger(number) || number < 1) return invalid();
    return number;
  };
  const page = positive(query.page, 1);
  const limit = positive(query.limit, 20);
  const skip = (page - 1) * limit;
  if (limit > 50 || !Number.isSafeInteger(skip)) return invalid();
  return { mode: 'list', page, limit, skip };
}
