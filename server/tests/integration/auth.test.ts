import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { config as loadEnv } from 'dotenv';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { validateServerEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/database/database.js';
import { createApp } from '../../src/app.js';
import { verifyToken } from '../../src/services/tokens.js';

// Never read a URI through a fallback. Validate before constructing any connection.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const config = validateServerEnv({ ...process.env, NODE_ENV: 'test',
  JWT_SECRET: randomBytes(32).toString('hex'), OPENROUTER_API_KEY: 'integration-no-provider-calls',
  CLIENT_ORIGINS: 'http://localhost:5173' });
const database = createDatabase(config.databaseUri);
const app = createApp({ config, users: database.users, readiness: database.readiness });
const emails = new Set<string>();
const conversationIds: string[] = [];
let initialized = false;
function email() { const value = 't02-' + randomUUID() + '@example.test'; emails.add(value); return value; }
const password = ' strong password ';
let accountEmail: string;
let accountId: string;
let token: string;

beforeAll(async () => {
  try { await database.initialize(); initialized = true; }
  catch { throw new Error('Dedicated test database initialization failed. Check test credentials and Atlas access; URI withheld.'); }
});
afterAll(async () => {
  try {
    if (initialized) {
      // Exact suite-generated identities only. Never drop or clear a collection.
      if (conversationIds.length) await database.conversations.deleteMany({ _id: { $in: conversationIds } });
      if (emails.size) await database.refreshSessions.deleteMany({ userId: { $in: (await database.users.find({ email: { $in: [...emails] } }).select('_id')).map((u) => u._id) } });
      await database.users.deleteMany({ email: { $in: [...emails] } });
      expect(await database.users.countDocuments({ email: { $in: [...emails] } })).toBe(0);
    }
  } catch { throw new Error('Test fixture cleanup failed; only this run?s generated fixtures may remain.'); }
  finally { await database.close(); }
});

describe('T-02 dedicated Atlas integration', () => {
  it('API-06 reports actual connected/index-ready state and indexes exist', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    const userIndexes = await database.users.collection.indexes();
    const conversationIndexes = await database.conversations.collection.indexes();
    expect(userIndexes.some((index) => index.unique && index.key.email === 1)).toBe(true);
    expect(conversationIndexes.some((index) => JSON.stringify(index.key) === JSON.stringify({ userId: 1, updatedAt: -1, _id: -1 }))).toBe(true);
  });
  it('AUTH-01/02 signs up with a public DTO and cost-12 hash excluded by default', async () => {
    accountEmail = email();
    const result = await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: ' ' + accountEmail.toUpperCase() + ' ', password });
    expect(result.status).toBe(201);
    expect(result.body.success).toBe(true);
    expect(Object.keys(result.body.data).sort()).toEqual(['expiresAt', 'token', 'user']);
    expect(Object.keys(result.body.data.user).sort()).toEqual(['email', 'id']);
    accountId = result.body.data.user.id as string;
    token = result.body.data.token as string;
    expect(verifyToken(token, config.jwtSecret)).toEqual({ userId: accountId });
    const user = await database.users.findById(accountId).select('+passwordHash');
    if (!user) throw new Error('Fixture missing');
    expect(bcrypt.getRounds(user.passwordHash)).toBe(12);
    expect(await bcrypt.compare(password, user.passwordHash)).toBe(true);
    expect((await database.users.findById(accountId))?.passwordHash).toBeUndefined();
    expect(JSON.stringify(result.body)).not.toContain(user.passwordHash);
    expect(JSON.stringify(user)).not.toContain(user.passwordHash);
  });
  it('AUTH-03 resolves normalized duplicate races through the unique index', async () => {
    const address = email();
    const results = await Promise.all([address, ' ' + address.toUpperCase() + ' '].map((value) =>
      request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: value, password })));
    expect(results.map((result) => result.status).sort()).toEqual([201, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe('EMAIL_EXISTS');
    expect(await database.users.countDocuments({ email: address })).toBe(1);
  });
  it('AUTH-04 accepts exact password boundaries and rejects truncation', async () => {
    for (const value of ['12345678', 'a'.repeat(72), '\u{1F600}'.repeat(18)]) {
      const address = email();
      expect((await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: address, password: value })).status).toBe(201);
      expect((await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: address, password: value })).status).toBe(200);
    }
    for (const value of ['1234567', 'a'.repeat(73), '\u{1F600}'.repeat(19)]) {
      const address = email();
      expect((await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: address, password: value })).status).toBe(400);
      expect(await database.users.exists({ email: address })).toBeNull();
    }
  });
  it('AUTH-05 normalizes login and uses identical generic failures, preserving spaces', async () => {
    const valid = await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: accountEmail.toUpperCase(), password });
    expect(valid.status).toBe(200);
    const wrong = await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: accountEmail, password: password.trim() });
    const missing = await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: email(), password });
    expect(wrong.status).toBe(401);
    expect(missing.status).toBe(401);
    expect(wrong.body).toEqual(missing.body);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });
  it('rejects forged ownership and query/operator payloads before writes', async () => {
    const address = email();
    for (const body of [{ email: address, password, userId: accountId }, { email: { $ne: null }, password }]) {
      expect((await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send(body)).status).toBe(400);
    }
    expect((await request(app).post('/auth/login?userId=forged').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: address, password })).status).toBe(400);
    expect(await database.users.exists({ email: address })).toBeNull();
  });
  it('persists the future Conversation schema, immutable owner, timestamps and version', async () => {
    const conversation = await database.conversations.create({ userId: accountId, title: 'Synthetic test',
      messages: [{ role: 'user', content: 'Hello', createdAt: new Date() },
        { role: 'assistant', content: 'Welcome', createdAt: new Date() }] });
    conversationIds.push(conversation.id as string);
    expect(conversation.__v).toBe(0);
    expect(conversation.createdAt).toBeInstanceOf(Date);
    const originalOwner = conversation.userId.toHexString();
    conversation.set('userId', '507f1f77bcf86cd799439099');
    await expect(conversation.save()).rejects.toThrow('immutable');
    expect((await database.conversations.findById(conversation._id))?.userId.toHexString()).toBe(originalOwner);
    expect(verifyToken(token, config.jwtSecret).userId).toBe(accountId);
  });
  it('API-06 becomes unavailable promptly after the database closes', async () => {
    // Fixtures are cleaned before closing; the afterAll close is idempotent.
    await database.conversations.deleteMany({ _id: { $in: conversationIds } });
    await database.refreshSessions.deleteMany({ userId: { $in: (await database.users.find({ email: { $in: [...emails] } }).select('_id')).map((u) => u._id) } });
      await database.users.deleteMany({ email: { $in: [...emails] } });
    expect(await database.users.countDocuments({ email: { $in: [...emails] } })).toBe(0);
    await database.close();
    initialized = false;
    expect((await request(app).get('/health')).status).toBe(503);
    expect((await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: accountEmail, password })).status).toBe(503);
  });
});
