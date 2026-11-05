import { Schema } from 'mongoose';
import type { Connection, Model } from 'mongoose';
import { isValidEmail, normalizeEmail } from '../validation/auth.js';

export interface UserRecord {
  email: string;
  passwordHash: string;
  createdAt: Date;
  updatedAt: Date;
}
export type UserModel = Model<UserRecord>;
export const userSchema = new Schema<UserRecord>({
  email: { type: String, required: true, set: normalizeEmail, validate: isValidEmail },
  passwordHash: { type: String, required: true, select: false, match: /^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/ },
}, {
  timestamps: true, strict: 'throw', bufferCommands: false, autoIndex: false, autoCreate: false,
  toJSON: { transform: (_document, result) => { Reflect.deleteProperty(result, 'passwordHash'); return result; } },
  toObject: { transform: (_document, result) => { Reflect.deleteProperty(result, 'passwordHash'); return result; } },
});
userSchema.index({ email: 1 }, { unique: true });
export function createUserModel(connection: Connection): UserModel {
  return connection.model<UserRecord>('User', userSchema);
}
