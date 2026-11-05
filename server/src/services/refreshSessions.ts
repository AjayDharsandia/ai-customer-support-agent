import { createHash, randomBytes } from 'node:crypto';
import type { RefreshSessionModel } from '../models/RefreshSession.js';
import { AppError } from '../errors/AppError.js';

export const REUSE_GRACE_MS = 10_000;
export const MAX_ROTATIONS = 2048;
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const unauthorized = () => new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
function decode(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{86}$/.test(token)) return null;
  const bytes = Buffer.from(token, 'base64url');
  if (bytes.length !== 64 || bytes.toString('base64url') !== token) return null;
  return { bytes, familyHash: hash(bytes.subarray(0, 32)), tokenHash: hash(bytes) };
}
export function createRefreshSessions(sessions: RefreshSessionModel, lifetimeSeconds: number) {
  async function create(userId: string) {
    const bytes = randomBytes(64);
    const token = bytes.toString('base64url');
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000);
    const expiresAt = new Date(createdAt.getTime() + lifetimeSeconds * 1000);
    await sessions.insertOne({ userId, familyHash: hash(bytes.subarray(0, 32)), tokenHash: hash(bytes),
      spent: [], createdAt, expiresAt, lastUsedAt: null, revokedAt: null },
    { w: 'majority', wtimeout: 5000 });
    return { token, expiresAt };
  }
  async function rotate(token: string | undefined) {
    const input = decode(token);
    if (!input) throw unauthorized();
    const now = new Date();
    const record = await sessions.findOne({ familyHash: input.familyHash }).exec();
    if (!record || record.revokedAt || record.expiresAt <= now) throw unauthorized();
    const rejectReuse = async () => {
      const latest = await sessions.findById(record._id).exec();
      if (!latest || latest.revokedAt || latest.expiresAt <= new Date()) throw unauthorized();
      const used = latest.spent.find((item) => item.hash === input.tokenHash);
      if (used && Date.now() - used.usedAt.getTime() <= REUSE_GRACE_MS) {
        // A losing concurrent request must not clear/overwrite the winner's cookie.
        throw new AppError(409, 'REFRESH_CONFLICT', 'Session refresh is already in progress. Please retry.');
      }
      if (used) await sessions.updateOne({ _id: latest._id, revokedAt: null },
        { $set: { revokedAt: new Date() } }, { writeConcern: { w: 'majority', wtimeoutMS: 5000 } }).exec();
      throw unauthorized();
    };
    if (record.tokenHash !== input.tokenHash) return rejectReuse();
    if (record.spent.length >= MAX_ROTATIONS) {
      await sessions.updateOne({ _id: record._id }, { $set: { revokedAt: now } },
        { writeConcern: { w: 'majority', wtimeoutMS: 5000 } }).exec();
      throw unauthorized();
    }
    const bytes = Buffer.concat([input.bytes.subarray(0, 32), randomBytes(32)]);
    const updated = await sessions.findOneAndUpdate({
      _id: record._id, tokenHash: input.tokenHash, revokedAt: null, expiresAt: { $gt: now },
      ['spent.' + (MAX_ROTATIONS - 1)]: { $exists: false },
    }, { $set: { tokenHash: hash(bytes), lastUsedAt: now }, $push: { spent: { hash: input.tokenHash, usedAt: now } } },
    { returnDocument: 'after', writeConcern: { w: 'majority', wtimeoutMS: 5000 } }).exec();
    if (!updated) return rejectReuse();
    if (updated.expiresAt <= new Date()) throw unauthorized();
    return { token: bytes.toString('base64url'), expiresAt: updated.expiresAt, userId: updated.userId.toHexString() };
  }
  async function revoke(token: string | undefined) {
    const input = decode(token);
    if (!input) return;
    // Accept a consumed credential for logout, including a rotation racing with logout.
    await sessions.updateOne({ familyHash: input.familyHash, revokedAt: null,
      $or: [{ tokenHash: input.tokenHash }, { 'spent.hash': input.tokenHash }] },
    { $set: { revokedAt: new Date() } }, { writeConcern: { w: 'majority', wtimeoutMS: 5000 } }).exec();
  }
  return { create, rotate, revoke };
}
