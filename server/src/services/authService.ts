import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { UserModel } from '../models/User.js';
import type { AuthRequest, PublicUser } from '../types/api.js';
import type { ServerConfig } from '../config/env.js';
import { AppError } from '../errors/AppError.js';
import { issueToken } from './tokens.js';
import { createRefreshSessions } from './refreshSessions.js';
import { createRefreshSessionModel } from '../models/RefreshSession.js';

const dummyHash = bcrypt.hash(randomBytes(32).toString('hex'), 12);
export function createAuthService(users: UserModel, config: Pick<ServerConfig, 'jwtSecret' | 'accessSeconds' | 'refreshSeconds'>) {
  const sessions = createRefreshSessions(createRefreshSessionModel(users.db), config.refreshSeconds);
  function access(user: PublicUser) {
    return { user, ...issueToken(user.id, config.jwtSecret, config.accessSeconds) };
  }
  async function establish(user: PublicUser, oldToken: string | undefined) {
    await sessions.revoke(oldToken);
    const refresh = await sessions.create(user.id);
    return { data: access(user), refresh };
  }
  async function signup(input: AuthRequest, oldToken?: string) {
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user = await users.create({ email: input.email, passwordHash });
    return establish({ id: user._id.toHexString(), email: user.email }, oldToken);
  }
  async function login(input: AuthRequest, oldToken?: string) {
    const user = await users.findOne({ email: input.email }).select('+passwordHash').exec();
    const matches = await bcrypt.compare(input.password, user?.passwordHash ?? await dummyHash);
    if (!user || !matches) throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    return establish({ id: user._id.toHexString(), email: user.email }, oldToken);
  }
  async function refresh(token: string | undefined) {
    const rotated = await sessions.rotate(token);
    const user = await users.findById(rotated.userId).exec();
    if (!user || rotated.expiresAt <= new Date()) {
      await sessions.revoke(rotated.token);
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication is required.');
    }
    return { data: access({ id: user._id.toHexString(), email: user.email }), refresh: rotated };
  }
  return { signup, login, refresh, logout: sessions.revoke };
}
