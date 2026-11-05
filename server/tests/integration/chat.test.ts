import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { config as loadEnv } from 'dotenv';
import { Types, mongo } from 'mongoose';
import request from 'supertest';
import { validateServerEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/database/database.js';
import { createApp } from '../../src/app.js';
import { createChatService } from '../../src/services/chatService.js';
import { createOpenRouter, SUPPORT_PROMPT } from '../../src/services/openRouter.js';
import { mockProvider } from '../helpers/mockProvider.js';
import type { SendChatData, ConversationDetail, HistoryListData } from '../../src/types/api.js';

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const config = validateServerEnv({ ...process.env, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
  OPENROUTER_API_KEY: 'synthetic-provider-secret', CLIENT_ORIGINS: 'http://localhost:5173' });
const db = createDatabase(config.databaseUri);
const provider = createOpenRouter(config);
const mock = mockProvider(provider.client);
const app = createApp({ config, users: db.users, readiness: db.readiness,
  chat: createChatService(db.conversations, provider.generateReply, provider.generateReplyStream) });
const emails = ['t03-' + randomUUID() + '@example.test', 't03-' + randomUUID() + '@example.test'];
const owners: string[] = [];
const tokens: string[] = [];
const password = 'test-password-123';
function owner(index = 0): string {
  const value = owners[index];
  if (!value) throw new Error('Fixture owner was not initialized.');
  return value;
}
let initialized = false;
const answer = { choices: [{ message: { content: '  Synthetic support reply  ', reasoning: 'hidden-provider-metadata' } }] };
const send = (body: object, account = 0) => request(app).post('/chat/send').set('Authorization', 'Bearer ' + tokens[account]).send(body);
const sendStream = (body: object, account = 0) => request(app).post('/chat/send/stream').set('Authorization', 'Bearer ' + tokens[account])
  .set('Accept', 'text/event-stream').send(body);
const history = (query = '', account = 0) => request(app).get('/chat/history' + query).set('Authorization', 'Bearer ' + tokens[account]);
function successfulAI() { mock.onPost().reply(200, answer); }
function providerStream(frames: string[]) { mock.onPost().reply(200, Readable.from(frames.map((frame) => Buffer.from(frame)))); }
function events(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  return body.trim().split(/\r?\n\r?\n/u).map((frame) => {
    const lines = frame.split(/\r?\n/u);
    const name = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
    const raw = lines.filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
    return { event: name, data: JSON.parse(raw) as Record<string, unknown> };
  });
}
async function seed(exchanges = 1, ownerId = owner()) {
  const doc = await db.conversations.create({ userId: ownerId, title: 'Seeded conversation',
    messages: Array.from({ length: exchanges * 2 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user', content: 'saved-' + index, createdAt: new Date(),
    })) });
  return doc;
}
beforeAll(async () => {
  try { await db.initialize(); initialized = true; }
  catch { throw new Error('Dedicated Atlas test connection failed; URI withheld.'); }
  for (const email of emails) {
    const result = await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email, password });
    expect(result.status).toBe(201);
    owners.push(result.body.data.user.id as string);
    tokens.push(result.body.data.token as string);
  }
});
afterEach(() => { mock.reset(); vi.restoreAllMocks(); });
afterAll(async () => {
  try {
    if (initialized) {
      // These owners were created by this suite. This also cleans committed writes
      // whose simulated lost acknowledgment intentionally withheld their IDs.
      if (owners.length) {
        await db.conversations.deleteMany({ userId: { $in: owners } });
        expect(await db.conversations.countDocuments({ userId: { $in: owners } })).toBe(0);
      }
      await db.refreshSessions.deleteMany({ userId: { $in: owners } });
      await db.users.deleteMany({ email: { $in: emails } });
      expect(await db.users.countDocuments({ email: { $in: emails } })).toBe(0);
    }
  } finally { await db.close(); }
});

describe('T-03 owned persistence with mocked OpenRouter', () => {
  it('STREAM-04 emits committed only after atomically saving the complete streamed pair', async () => {
    providerStream([
      'data: {"choices":[{"delta":{"content":"Synthetic "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"streamed 😀"}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    const result = await sendStream({ message: 'Stream this response' });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toContain('text/event-stream');
    const received = events(result.text);
    expect(received.map(({ event }) => event)).toEqual(['started', 'delta', 'delta', 'committed']);
    const committed = received.at(-1)?.data as unknown as SendChatData;
    expect(committed.assistantMessage.content).toBe('Synthetic streamed 😀');
    const saved = await db.conversations.findOne({ _id: committed.conversationId, userId: owner() }).lean();
    expect(saved?.messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: 'Stream this response' },
      { role: 'assistant', content: 'Synthetic streamed 😀' },
    ]);
  });

  it('STREAM-05 never persists a partial response when the provider stream fails', async () => {
    const before = await db.conversations.countDocuments({ userId: owner() });
    providerStream([
      'data: {"choices":[{"delta":{"content":"Incomplete"}}]}\n\n',
      'data: {"error":{"message":"provider failed"}}\n\n',
    ]);
    const result = await sendStream({ message: 'Do not save this' });
    const received = events(result.text);
    expect(received.map(({ event }) => event)).toEqual(['started', 'delta', 'error']);
    expect(received.at(-1)?.data).toMatchObject({ code: 'AI_UNAVAILABLE', outcome: 'not_saved' });
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(before);
  });

  it('DATA-01/02/05 returns canonical saved pairs, stable title and ordered continuation', async () => {
    successfulAI();
    const text = '  Help   with\n my account ' + '\u{1F600}'.repeat(90) + '  ';
    const result = await send({ message: text });
    expect(result.status).toBe(200);
    const data = result.body.data as SendChatData;
    expect(Object.keys(data).sort()).toEqual(['assistantMessage', 'conversationId', 'title', 'updatedAt', 'userMessage']);
    expect(data.title).toBe(Array.from(text.trim().replace(/\s+/gu, ' ')).slice(0, 80).join(''));
    expect(data.userMessage.content).toBe(text.trim());
    expect(data.assistantMessage.content).toBe('Synthetic support reply');
    expect(data.userMessage.id).not.toBe(data.assistantMessage.id);
    expect(data.userMessage.id).toMatch(/^[a-f0-9]{24}$/);
    expect(Object.keys(data.userMessage).sort()).toEqual(['content', 'createdAt', 'id', 'role']);
    expect(new Date(data.updatedAt).toISOString()).toBe(data.updatedAt);
    const saved = await db.conversations.findOne({ _id: data.conversationId, userId: owner() });
    expect(saved?.messages).toHaveLength(2);
    expect(saved?.__v).toBe(0);
    const next = await send({ message: 'Continue', conversationId: data.conversationId });
    expect(next.status).toBe(200);
    const detailResult = await history('?conversationId=' + data.conversationId);
    expect(detailResult.status).toBe(200);
    const detail = detailResult.body.data as ConversationDetail;
    expect(Object.keys(detail).sort()).toEqual(['createdAt', 'id', 'messages', 'title', 'updatedAt']);
    expect(detail.title).toBe(data.title);
    expect(detail.createdAt).toBe(saved?.createdAt.toISOString());
    expect(detail.messages).toEqual([data.userMessage, data.assistantMessage, next.body.data.userMessage, next.body.data.assistantMessage]);
    expect(detail.updatedAt > data.updatedAt).toBe(true);
    expect((await db.conversations.findById(data.conversationId))?.__v).toBe(1);
    expect(JSON.stringify(detail)).not.toContain('hidden-provider-metadata');
  });
  it('DATA-03 paginates owner summaries with deterministic tied-time ordering and empty pages', async () => {
    // B has no previous fixtures; A already has data, which must not leak to B.
    expect((await history('', 1)).body.data.conversations).toEqual([]);
    const a = await seed(1, owner(1)); const b = await seed(1, owner(1)); const c = await seed(1, owner(1));
    const tied = new Date('2026-01-01T00:00:00Z');
    await db.conversations.updateMany({ _id: { $in: [a._id, b._id] }, userId: owner(1) }, { $set: { updatedAt: tied } }, { timestamps: false });
    const expected = [c.id, ...[a.id, b.id].sort().reverse()];
    const first = (await history('?page=1&limit=2', 1)).body.data as HistoryListData;
    expect(first.conversations.map((item) => item.id)).toEqual(expected.slice(0, 2));
    expect(first.pagination).toEqual({ page: 1, limit: 2, total: 3, hasMore: true });
    expect(Object.keys(first.conversations[0]!).sort()).toEqual(['createdAt', 'id', 'title', 'updatedAt']);
    const second = (await history('?page=2&limit=2', 1)).body.data as HistoryListData;
    expect(second.conversations.map((item) => item.id)).toEqual(expected.slice(2));
    expect(second.pagination.hasMore).toBe(false);
    expect((await history('?page=99&limit=2', 1)).body.data.conversations).toEqual([]);
    expect((await history('', 1)).body.data.pagination).toEqual({ page: 1, limit: 20, total: 3, hasMore: false });
  });
  it('DATA-04 denies foreign/missing reads and writes identically before generation', async () => {
    const own = await seed();
    const missing = new Types.ObjectId().toHexString();
    const before = own.toObject();
    for (const operation of ['read', 'send']) {
      const results = await Promise.all([own.id, missing].map((id) => operation === 'read'
        ? history('?conversationId=' + id, 1) : send({ message: 'Try access', conversationId: id }, 1)));
      expect(results.map((result) => result.status)).toEqual([404, 404]);
      expect(results[0]?.body).toEqual(results[1]?.body);
      expect(results[0]?.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    }
    expect(mock.history.post).toHaveLength(0);
    expect((await db.conversations.findById(own._id))?.toObject()).toEqual(before);
  });
  it('AI-01 sends only recent owned context, without identifiers or credentials', async () => {
    successfulAI();
    const doc = await seed(12);
    const result = await send({ message: 'Newest', conversationId: doc.id });
    expect(result.status).toBe(200);
    const body = JSON.parse(mock.history.post[0]?.data as string) as { messages: unknown[] };
    expect(body.messages).toEqual([{ role: 'system', content: SUPPORT_PROMPT },
      ...Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: 'saved-' + (i + 4) })),
      { role: 'user', content: 'Newest' }]);
    expect(JSON.stringify(body)).not.toContain(owner());
    expect(JSON.stringify(body)).not.toContain(tokens[0]);
  });
  it('DATA-06 allows exchange 100, then rejects before generation while retaining readable history', async () => {
    successfulAI();
    const doc = await seed(99);
    expect((await send({ message: 'Last', conversationId: doc.id })).status).toBe(200);
    const full = await send({ message: 'Too many', conversationId: doc.id });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe('CONVERSATION_LIMIT_REACHED');
    expect(mock.history.post).toHaveLength(1);
    expect((await history('?conversationId=' + doc.id)).body.data.messages).toHaveLength(200);
  });
  it.each([1, 99])('DATA-06/07 racing sends from %s pairs commit exactly one complete pair', async (count) => {
    const doc = await seed(count);
    let release = () => {};
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    mock.onPost().reply(async () => { calls++; await gate; return [200, answer]; });
    const first = send({ message: 'First contender', conversationId: doc.id }).then((result) => result);
    const second = send({ message: 'Second contender', conversationId: doc.id }).then((result) => result);
    try { await vi.waitFor(() => expect(calls).toBe(2), { timeout: 5000 }); }
    finally { release(); }
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(results.find((result) => result.status === 409)?.body.error.code).toBe('CONVERSATION_CHANGED');
    const stored = await db.conversations.findById(doc._id);
    expect(stored?.messages).toHaveLength(count * 2 + 2);
    expect(stored?.__v).toBe(1);
    const winner = results.find((result) => result.status === 200)?.body.data as SendChatData;
    expect(stored?.messages.at(-2)?.content).toBe(winner.userMessage.content);
    expect(stored?.messages.at(-1)?.content).toBe(winner.assistantMessage.content);
    expect(mock.history.post).toHaveLength(2);
  });
  it.each([
    [504, 504, 'AI_TIMEOUT'], [429, 429, 'AI_RATE_LIMITED'], [503, 503, 'AI_UNAVAILABLE'],
    [401, 502, 'AI_REQUEST_FAILED'], [402, 502, 'AI_REQUEST_FAILED'], [400, 502, 'AI_REQUEST_FAILED'],
    [404, 502, 'AI_REQUEST_FAILED'], [500, 502, 'AI_REQUEST_FAILED'],
  ])('AI-02/03/04 provider %s cannot persist a new or existing exchange', async (upstream, status, code) => {
    const doc = await seed();
    const count = await db.conversations.countDocuments({ userId: owner() });
    mock.onPost().reply(upstream, { error: { message: 'private-provider-marker' } });
    for (const input of [{ message: 'New failure' }, { message: 'Existing failure', conversationId: doc.id }]) {
      const result = await send(input);
      expect(result.status).toBe(status);
      expect(result.body.error.code).toBe(code);
      expect(JSON.stringify(result.body)).not.toContain('private-provider-marker');
    }
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(count);
    expect((await db.conversations.findById(doc._id))?.messages).toHaveLength(2);
    expect(mock.history.post).toHaveLength(2);
  });
  it('AI-02/03 network timeout/failure do not save or retry', async () => {
    const count = await db.conversations.countDocuments({ userId: owner() });
    mock.onPost().timeoutOnce();
    expect((await send({ message: 'Timeout' })).body.error.code).toBe('AI_TIMEOUT');
    mock.onPost().networkErrorOnce();
    expect((await send({ message: 'Network' })).body.error.code).toBe('AI_UNAVAILABLE');
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(count);
    expect(mock.history.post).toHaveLength(2);
  });
  it.each([{}, { choices: [] }, { choices: [{ message: { content: ' ' } }] },
    { choices: [{ message: { content: ['invalid'] } }] },
    { choices: [{ message: { content: 'a'.repeat(16001) } }] },
    { ...answer, error: { message: 'private' } }])('AI-05 malformed success saves nothing', async (body) => {
    const count = await db.conversations.countDocuments({ userId: owner() });
    mock.onPost().reply(200, body);
    const result = await send({ message: 'Invalid response' });
    expect(result.status).toBe(502);
    expect(result.body.error.code).toBe('AI_RESPONSE_INVALID');
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(count);
    expect(mock.history.post).toHaveLength(1);
  });
  it('API-02 accepts 4000 code points and rejects overflow/forged fields with no provider calls', async () => {
    successfulAI();
    expect((await send({ message: '\u{1F600}'.repeat(4000) })).status).toBe(200);
    mock.resetHistory();
    const count = await db.conversations.countDocuments({ userId: owner() });
    for (const body of [{ message: 'a'.repeat(4001) }, { message: 'Hello', userId: owner(1) }, { message: { $ne: null } }]) {
      expect((await send(body)).status).toBe(400);
    }
    expect(mock.history.post).toHaveLength(0);
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(count);
  });
  it('AI-06 failed inserts/appends do not expose unsaved answers or partial pairs', async () => {
    successfulAI();
    const doc = await seed();
    const count = await db.conversations.countDocuments({ userId: owner() });
    vi.spyOn(db.conversations.collection, 'insertOne').mockRejectedValueOnce(new mongo.MongoNetworkError('private-write-marker'));
    const result = await send({ message: 'Insertion failure' });
    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain('Synthetic support reply');
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(count);
    vi.spyOn(db.conversations.collection, 'findOneAndUpdate').mockRejectedValueOnce(new mongo.MongoNetworkError('private-write-marker'));
    expect((await send({ message: 'Append failure', conversationId: doc.id })).status).toBe(503);
    expect((await db.conversations.findById(doc._id))?.messages).toHaveLength(2);
    expect(mock.history.post).toHaveLength(2);
  });
  it('AI-06 lost insert acknowledgment leaves one complete pair and never retries', async () => {
    successfulAI();
    const before = await db.conversations.countDocuments({ userId: owner() });
    const insert = db.conversations.collection.insertOne.bind(db.conversations.collection);
    vi.spyOn(db.conversations.collection, 'insertOne').mockImplementationOnce(async (...args) => {
      await insert(...args);
      throw new mongo.MongoNetworkError('simulated-lost-acknowledgment');
    });
    const result = await send({ message: 'Uncertain commit fixture' });
    expect(result.status).toBe(503);
    expect(result.body.success).toBe(false);
    expect(mock.history.post).toHaveLength(1);
    expect(await db.conversations.countDocuments({ userId: owner() })).toBe(before + 1);
    const saved = await db.conversations.findOne({ userId: owner(), title: 'Uncertain commit fixture' });
    expect(saved?.messages).toHaveLength(2);
    expect((await history('?conversationId=' + saved?.id)).body.data.messages).toHaveLength(2);
  });
  it('DATA-06 enforces capacity even when a competing writer does not advance version', async () => {
    const doc = await seed(99);
    mock.onPost().reply(async () => {
      await db.conversations.updateOne({ _id: doc._id, userId: doc.userId }, {
        $push: { messages: { $each: [
          { _id: new Types.ObjectId(), role: 'user', content: 'Competing user', createdAt: new Date() },
          { _id: new Types.ObjectId(), role: 'assistant', content: 'Competing reply', createdAt: new Date() },
        ] } },
      });
      return [200, answer];
    });
    const result = await send({ message: 'Capacity contender', conversationId: doc.id });
    expect(result.status).toBe(409);
    expect(result.body.error.code).toBe('CONVERSATION_CHANGED');
    expect((await db.conversations.findById(doc._id))?.messages).toHaveLength(200);
    expect(mock.history.post).toHaveLength(1);
  });
  it('AI-06 lost append acknowledgment leaves one complete pair without retrying', async () => {
    successfulAI();
    const doc = await seed();
    const append = db.conversations.collection.findOneAndUpdate.bind(db.conversations.collection);
    vi.spyOn(db.conversations.collection, 'findOneAndUpdate').mockImplementationOnce(async (...args) => {
      await append(...args);
      throw new mongo.MongoNetworkError('simulated-lost-append-acknowledgment');
    });
    const result = await send({ message: 'Uncertain append', conversationId: doc.id });
    expect(result.status).toBe(503);
    expect(result.body.success).toBe(false);
    expect(mock.history.post).toHaveLength(1);
    const saved = await db.conversations.findById(doc._id);
    expect(saved?.messages).toHaveLength(4);
    expect(saved?.__v).toBe(1);
    expect((await history('?conversationId=' + doc.id)).body.data.messages).toHaveLength(4);
  });
  it('DATA-08 survives an actual API process restart and fresh login', async () => {
    async function startChild() {
      const child = fork(fileURLToPath(new URL('../helpers/restartServer.ts', import.meta.url)), {
        execArgv: ['--import', 'tsx'], silent: true,
        env: { ...process.env, NODE_ENV: 'test', JWT_SECRET: config.jwtSecret,
          OPENROUTER_API_KEY: 'synthetic-provider-secret', CLIENT_ORIGINS: 'http://localhost:5173' },
      });
      // Consume streams without exposing configuration if the child fails.
      child.stdout?.resume(); child.stderr?.resume();
      const stop = async () => {
        if (child.exitCode !== null) return;
        const exited = once(child, 'exit');
        child.send('shutdown');
        const deadline = setTimeout(() => child.kill(), 5000);
        await exited; clearTimeout(deadline);
      };
      try {
        const port = await new Promise<number>((resolve, reject) => {
          const timer = setTimeout(() => { child.kill(); reject(new Error('Test server startup timed out.')); }, 15000);
          child.once('message', (message: unknown) => {
            clearTimeout(timer);
            if (typeof message === 'object' && message !== null && 'port' in message && typeof message.port === 'number') resolve(message.port);
            else reject(new Error('Invalid test server startup response.'));
          });
          child.once('exit', () => { clearTimeout(timer); reject(new Error('Test server exited during startup.')); });
          child.once('error', () => { clearTimeout(timer); reject(new Error('Test server could not start.')); });
        });
        return { url: 'http://127.0.0.1:' + port, stop };
      } catch (error) { child.kill(); throw error; }
    }
    let child = await startChild();
    let saved: SendChatData;
    try {
      const login = await request(child.url).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: emails[0], password });
      expect(login.status).toBe(200);
      const result = await request(child.url).post('/chat/send').set('Authorization', 'Bearer ' + login.body.data.token).send({ message: 'Restart persistence fixture' });
      expect(result.status).toBe(200);
      saved = result.body.data as SendChatData;
    } finally { await child.stop(); }
    child = await startChild();
    try {
      const login = await request(child.url).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: emails[0], password });
      expect(login.status).toBe(200);
      const result = await request(child.url).get('/chat/history?conversationId=' + saved.conversationId).set('Authorization', 'Bearer ' + login.body.data.token);
      expect(result.status).toBe(200);
      expect(result.body.data.messages).toEqual([saved.userMessage, saved.assistantMessage]);
    } finally { await child.stop(); }
  }, 45000);
});
