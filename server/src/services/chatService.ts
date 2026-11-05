import { Types } from 'mongoose';
import type { createConversationModel } from '../models/Conversation.js';
import type { ChatMessage, ConversationSummary, ConversationDetail, HistoryListData, SendChatRequest, SendChatData } from '../types/api.js';
import type { GenerateReply, GenerateReplyStream, AIMessage } from './openRouter.js';
import type { HistoryQuery } from '../validation/chat.js';
import { AppError } from '../errors/AppError.js';

type ConversationModel = ReturnType<typeof createConversationModel>;
interface StoredMessage { _id: Types.ObjectId; role: string; content: string; createdAt: Date }
interface StoredSummary { _id: Types.ObjectId; title: string; createdAt: Date; updatedAt: Date }
interface ExistingConversation extends StoredSummary {
  userId: Types.ObjectId;
  messages: StoredMessage[];
  __v: number;
}
interface PreparedSend {
  userId: string;
  input: SendChatRequest;
  existing: ExistingConversation | null;
  history: AIMessage[];
  userMessage: StoredMessage & { role: 'user' };
}
export interface ChatStreamOperation {
  existingConversationId: string | null;
  run(onDelta: (text: string) => Promise<void>, signal: AbortSignal): Promise<SendChatData>;
}

function publicMessage(message: StoredMessage): ChatMessage {
  if (message.role !== 'user' && message.role !== 'assistant') throw new Error('Invalid stored message role.');
  return { id: message._id.toHexString(), role: message.role, content: message.content, createdAt: message.createdAt.toISOString() };
}
function summary(conversation: StoredSummary): ConversationSummary {
  return { id: conversation._id.toHexString(), title: conversation.title,
    createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() };
}
function notFound(): never {
  throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'The conversation was not found.');
}
export function createChatService(
  conversations: ConversationModel, generateReply: GenerateReply, generateReplyStream?: GenerateReplyStream,
) {
  async function prepare(userId: string, input: SendChatRequest): Promise<PreparedSend> {
    const existing = input.conversationId
      ? await conversations.findOne({ _id: input.conversationId, userId }).exec() as ExistingConversation | null : null;
    if (input.conversationId && !existing) return notFound();
    if (existing && existing.messages.length >= 200) {
      throw new AppError(409, 'CONVERSATION_LIMIT_REACHED', 'This conversation is full. Start a new conversation.');
    }
    const history: AIMessage[] = existing
      ? existing.messages.slice(-20).map((message) => {
        const { role, content } = publicMessage(message);
        return { role, content };
      }) : [];
    return {
      userId, input, existing, history,
      userMessage: { _id: new Types.ObjectId(), role: 'user', content: input.message, createdAt: new Date() },
    };
  }
  async function persist(prepared: PreparedSend, content: string): Promise<SendChatData> {
    const assistantMessage = { _id: new Types.ObjectId(), role: 'assistant' as const, content, createdAt: new Date() };
    const pair = [prepared.userMessage, assistantMessage];
    let saved;
    if (prepared.existing) {
      // Capacity and version are tested in the same atomic write that appends BOTH messages.
      // No upsert, retry, or separate pending-message write.
      saved = await conversations.findOneAndUpdate({
        _id: prepared.existing._id, userId: prepared.userId, __v: prepared.existing.__v,
        $expr: { $lte: [{ $size: '$messages' }, 198] },
      }, {
        $push: { messages: { $each: pair } }, $inc: { __v: 1 },
        $set: { updatedAt: new Date() },
      }, { returnDocument: 'after', runValidators: true, writeConcern: { w: 'majority', wtimeoutMS: 5000 } }).exec();
      if (!saved) throw new AppError(409, 'CONVERSATION_CHANGED', 'The conversation changed. Reload it before sending again.');
    } else {
      saved = await new conversations({
        userId: prepared.userId,
        title: Array.from(prepared.input.message.replace(/\s+/gu, ' ')).slice(0, 80).join(''), messages: pair,
      }).save({ w: 'majority', wtimeout: 5000 });
    }
    return { conversationId: saved._id.toHexString(), title: saved.title,
      userMessage: publicMessage(prepared.userMessage), assistantMessage: publicMessage(assistantMessage),
      updatedAt: saved.updatedAt.toISOString() };
  }
  async function send(userId: string, input: SendChatRequest): Promise<SendChatData> {
    const prepared = await prepare(userId, input);
    return persist(prepared, await generateReply(prepared.history, input.message));
  }
  async function stream(userId: string, input: SendChatRequest): Promise<ChatStreamOperation> {
    if (!generateReplyStream) throw new AppError(503, 'AI_UNAVAILABLE', 'The AI service is temporarily unavailable.');
    const prepared = await prepare(userId, input);
    let used = false;
    return {
      existingConversationId: prepared.existing?._id.toHexString() ?? null,
      async run(onDelta, signal) {
        if (used) throw new Error('A chat stream operation can only run once.');
        used = true;
        const content = await generateReplyStream(prepared.history, input.message, onDelta, signal);
        if (signal.aborted) throw signal.reason ?? new Error('Stream canceled.');
        return persist(prepared, content);
      },
    };
  }
  async function history(userId: string, query: HistoryQuery): Promise<ConversationDetail | HistoryListData> {
    if (query.mode === 'detail') {
      const conversation = await conversations.findOne({ _id: query.conversationId, userId }).exec();
      if (!conversation) return notFound();
      return { ...summary(conversation), messages: conversation.messages.map(publicMessage) };
    }
    const filter = { userId };
    const [items, total] = await Promise.all([
      conversations.find(filter).select('_id title createdAt updatedAt')
        .sort({ updatedAt: -1, _id: -1 }).skip(query.skip).limit(query.limit).exec(),
      conversations.countDocuments(filter).exec(),
    ]);
    return { conversations: items.map(summary),
      pagination: { page: query.page, limit: query.limit, total, hasMore: query.skip + items.length < total } };
  }
  return { send, stream, history };
}
export type ChatService = ReturnType<typeof createChatService>;
