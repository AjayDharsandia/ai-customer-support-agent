import axios from 'axios';
import type { SendChatRequest } from '../types/api';
import { ChatStreamError } from '../api/chat';

export interface SendIssue {
  message: string;
  recovery: 'retry' | 'reload' | 'reviewed' | 'new';
}
export function validateMessage(input: SendChatRequest): string | null {
  const count = Array.from(input.message).length;
  if (!count || count > 4000) return 'Enter a message between 1 and 4,000 characters.';
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > 16 * 1024) {
    return 'This message is too large to send. Please shorten it.';
  }
  return null;
}
export function sendIssue(error: unknown): SendIssue {
  if (error instanceof ChatStreamError && error.outcome === 'unknown') {
    return { message: 'We could not confirm whether your message was saved. Reload saved history and check for a reply before deciding to send again.', recovery: 'reload' };
  }
  const body: unknown = axios.isAxiosError(error) ? error.response?.data : undefined;
  const detail = typeof body === 'object' && body !== null && 'error' in body ? body.error : undefined;
  const code = error instanceof ChatStreamError ? error.code :
    typeof detail === 'object' && detail !== null && 'code' in detail ? detail.code : undefined;
  switch (code) {
    case 'VALIDATION_ERROR': case 'INVALID_JSON':
      return { message: 'Please check your message. Your draft has been kept.', recovery: 'retry' };
    case 'PAYLOAD_TOO_LARGE':
      return { message: 'Your message is too large. Shorten your draft and try again.', recovery: 'retry' };
    case 'AI_RATE_LIMITED':
      return { message: 'The AI service has reached its current limit. Your draft is kept; try again later.', recovery: 'retry' };
    case 'AI_TIMEOUT':
      return { message: 'The AI service timed out without saving a reply. Your draft is kept; you can try again.', recovery: 'retry' };
    case 'AI_UNAVAILABLE': case 'AI_REQUEST_FAILED': case 'AI_RESPONSE_INVALID':
      return { message: 'The AI service could not provide a reply. Your draft is kept; please try again later.', recovery: 'retry' };
    case 'CONVERSATION_CHANGED':
      return { message: 'This conversation changed elsewhere. Reload its saved messages before sending your draft again.', recovery: 'reload' };
    case 'CONVERSATION_LIMIT_REACHED':
      return { message: 'This conversation is full. Start a new chat to continue.', recovery: 'new' };
    case 'CONVERSATION_NOT_FOUND':
      return { message: 'This conversation is no longer available. Start a new chat to continue.', recovery: 'new' };
    default:
      return { message: 'We could not confirm whether your message was saved. It may still finish. Reload saved history and check for a reply before deciding to send again.', recovery: 'reload' };
  }
}
