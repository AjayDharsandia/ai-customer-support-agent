import { Schema } from 'mongoose';
import type { Connection, InferSchemaType } from 'mongoose';

const messageSchema = new Schema({
  role: { type: String, required: true, enum: ['user', 'assistant'] },
  content: {
    type: String, required: true,
    validate: function (this: { role: string }, value: string) {
      return value.trim().length > 0 && Array.from(value).length <= (this.role === 'user' ? 4_000 : 16_000);
    },
  },
  createdAt: { type: Date, required: true },
}, { strict: 'throw' });

export const conversationSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
  title: { type: String, required: true, validate: (value: string) => value.trim().length > 0 && Array.from(value).length <= 80 },
  messages: {
    type: [messageSchema], required: true,
    validate: (messages: { role: string }[]) => messages.length >= 2 &&
      messages.length <= 200 && messages.length % 2 === 0 &&
      messages.every((message, index) => message.role === (index % 2 === 0 ? 'user' : 'assistant')),
  },
}, {
  timestamps: true, versionKey: '__v', optimisticConcurrency: true, strict: 'throw',
  bufferCommands: false, autoIndex: false, autoCreate: false,
});
conversationSchema.index({ userId: 1, updatedAt: -1, _id: -1 });
export type ConversationRecord = InferSchemaType<typeof conversationSchema>;
export function createConversationModel(connection: Connection) {
  return connection.model('Conversation', conversationSchema);
}
