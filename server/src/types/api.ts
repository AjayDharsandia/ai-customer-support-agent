// Public contract: docs/ARCHITECTURE.md. Keep in sync with the client types.
export type ISODate = string;
export type ObjectIdString = string;

export interface ApiSuccess<T> { success: true; data: T }
export interface ApiError {
  success: false;
  error: { code: string; message: string; details?: Record<string, string> };
}
export interface PublicUser { id: ObjectIdString; email: string }
export interface AuthRequest { email: string; password: string }
export interface AuthData { user: PublicUser; token: string; expiresAt: ISODate }
export type RefreshRequest = Record<string, never>;
export type LogoutRequest = Record<string, never>;
export interface LogoutData { loggedOut: true }
export interface ChatMessage {
  id: ObjectIdString;
  role: 'user' | 'assistant';
  content: string;
  createdAt: ISODate;
}
export interface ConversationSummary {
  id: ObjectIdString;
  title: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}
export interface ConversationDetail extends ConversationSummary { messages: ChatMessage[] }
export interface HistoryListData {
  conversations: ConversationSummary[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
}
export interface SendChatRequest { message: string; conversationId?: ObjectIdString }
export interface SendChatData {
  conversationId: ObjectIdString;
  title: string;
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
  updatedAt: ISODate;
}
export interface HealthData { status: 'ok' }
