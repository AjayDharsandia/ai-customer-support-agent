import { Schema } from 'mongoose';
import type { Connection, Model, Types } from 'mongoose';

export interface RefreshSessionRecord {
  userId: Types.ObjectId;
  familyHash: string;
  tokenHash: string;
  spent: { hash: string; usedAt: Date }[];
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}
export type RefreshSessionModel = Model<RefreshSessionRecord>;
const schema = new Schema<RefreshSessionRecord>({
  userId: { type: Schema.Types.ObjectId, required: true, immutable: true },
  familyHash: { type: String, required: true, immutable: true },
  tokenHash: { type: String, required: true },
  spent: { type: [{ _id: false, hash: { type: String, required: true }, usedAt: { type: Date, required: true } }], default: [] },
  createdAt: { type: Date, required: true, immutable: true },
  expiresAt: { type: Date, required: true, immutable: true },
  lastUsedAt: { type: Date, default: null },
  revokedAt: { type: Date, default: null },
}, { strict: 'throw', bufferCommands: false, autoIndex: false, autoCreate: false });
schema.index({ familyHash: 1 }, { unique: true });
schema.index({ tokenHash: 1 }, { unique: true });
schema.index({ userId: 1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export function createRefreshSessionModel(connection: Connection): RefreshSessionModel {
  return (connection.models.RefreshSession as RefreshSessionModel | undefined) ??
    connection.model<RefreshSessionRecord>('RefreshSession', schema);
}
