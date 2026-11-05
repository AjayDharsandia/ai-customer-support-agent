import { apiClient } from './client';
import type { ApiSuccess, ConversationDetail, HistoryListData, SendChatData, SendChatRequest } from '../types/api';

interface RequestScope { signal: AbortSignal; sessionGeneration: number }
interface StreamEvent { event: string; data: unknown }
export class ChatStreamError extends Error {
  constructor(public readonly code: string, public readonly outcome: 'not_saved' | 'unknown', message: string) {
    super(message); this.name = 'ChatStreamError';
  }
}
function data<T>(body: ApiSuccess<T>): T {
  if (!body?.success || !body.data) throw new Error('Invalid API response.');
  return body.data;
}
export async function fetchHistory(page: number, scope: RequestScope): Promise<HistoryListData> {
  const response = await apiClient.get<ApiSuccess<HistoryListData>>('/chat/history', {
    ...scope, params: { page, limit: 5 },
  });
  const result = data(response.data);
  if (!Array.isArray(result.conversations) || !result.pagination) throw new Error('Invalid history response.');
  return result;
}
export async function fetchConversation(conversationId: string, scope: RequestScope): Promise<ConversationDetail> {
  const response = await apiClient.get<ApiSuccess<ConversationDetail>>('/chat/history', {
    ...scope, params: { conversationId },
  });
  const result = data(response.data);
  if (result.id !== conversationId || !Array.isArray(result.messages)) throw new Error('Invalid conversation response.');
  return result;
}
export async function sendMessage(input: SendChatRequest, scope: RequestScope): Promise<SendChatData> {
  const response = await apiClient.post<ApiSuccess<SendChatData>>('/chat/send', input, scope);
  const result = data(response.data);
  if (!result.conversationId || !result.title || !result.updatedAt ||
    result.userMessage?.role !== 'user' || result.assistantMessage?.role !== 'assistant' ||
    !result.userMessage.id || !result.assistantMessage.id ||
    typeof result.userMessage.content !== 'string' || typeof result.assistantMessage.content !== 'string' ||
    (input.conversationId && result.conversationId !== input.conversationId)) {
    throw new Error('The saved exchange could not be confirmed.');
  }
  return result;
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function confirmed(input: SendChatRequest, value: unknown, streamed: string): SendChatData {
  if (!object(value)) throw new Error('The saved exchange could not be confirmed.');
  const result = value as unknown as SendChatData;
  if (!result.conversationId || !result.title || !result.updatedAt ||
    result.userMessage?.role !== 'user' || result.assistantMessage?.role !== 'assistant' ||
    !result.userMessage.id || !result.assistantMessage.id ||
    result.userMessage.content !== input.message || result.assistantMessage.content !== streamed.trim() ||
    (input.conversationId && result.conversationId !== input.conversationId)) {
    throw new Error('The saved exchange could not be confirmed.');
  }
  return result;
}
async function consumeSse(
  body: ReadableStream<Uint8Array>, input: SendChatRequest, onDelta: (text: string) => void,
): Promise<SendChatData> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = '';
  let dataLines: string[] = [];
  let started = false;
  let streamed = '';
  let terminal: SendChatData | ChatStreamError | undefined;
  const dispatch = () => {
    if (!eventName && dataLines.length === 0) return;
    const event: StreamEvent = { event: eventName || 'message', data: (() => {
      try { return JSON.parse(dataLines.join('\n')); }
      catch { throw new Error('The streaming response was malformed.'); }
    })() };
    eventName = ''; dataLines = [];
    if (event.event === 'started') {
      if (started || !object(event.data) ||
        event.data.conversationId !== (input.conversationId ?? null)) throw new Error('The streaming response was malformed.');
      started = true;
      return;
    }
    if (!started || terminal) throw new Error('The streaming response was malformed.');
    if (event.event === 'delta') {
      if (!object(event.data) || typeof event.data.text !== 'string' || !event.data.text) {
        throw new Error('The streaming response was malformed.');
      }
      streamed += event.data.text;
      if (Array.from(streamed).length > 16_000) throw new Error('The streaming response was too large.');
      onDelta(event.data.text);
      return;
    }
    if (event.event === 'committed') {
      terminal = confirmed(input, event.data, streamed);
      return;
    }
    if (event.event === 'error') {
      if (!object(event.data) || typeof event.data.code !== 'string' || typeof event.data.message !== 'string' ||
        !['not_saved', 'unknown'].includes(String(event.data.outcome))) throw new Error('The streaming response was malformed.');
      terminal = new ChatStreamError(event.data.code,
        event.data.outcome as 'not_saved' | 'unknown', event.data.message);
      return;
    }
    throw new Error('The streaming response was malformed.');
  };
  const process = (value: string) => {
    buffer += value;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') { dispatch(); continue; }
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) eventName = line.slice(6).trimStart();
      else if (line === 'data') dataLines.push('');
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  };
  try {
    while (!terminal) {
      const { done, value } = await reader.read();
      if (done) break;
      process(decoder.decode(value, { stream: true }));
    }
    process(decoder.decode());
  } finally {
    if (terminal) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (terminal instanceof ChatStreamError) throw terminal;
  if (!terminal) throw new Error('The stream ended before persistence was confirmed.');
  return terminal;
}
export async function sendMessageStream(
  input: SendChatRequest, scope: RequestScope, onDelta: (text: string) => void,
): Promise<SendChatData> {
  const response = await apiClient.post<ReadableStream<Uint8Array>>('/chat/send/stream', input, {
    ...scope, adapter: 'fetch', responseType: 'stream', headers: { Accept: 'text/event-stream' },
  });
  const header = response.headers['content-type'];
  const contentType = typeof header === 'string' ? header : '';
  if (!contentType.toLowerCase().startsWith('text/event-stream') ||
    !response.data || typeof response.data.getReader !== 'function') {
    throw new Error('The streaming response was unavailable.');
  }
  return consumeSse(response.data, input, onDelta);
}
