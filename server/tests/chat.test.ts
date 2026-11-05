import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database/database.js';
import { issueToken } from '../src/services/tokens.js';
import { AppError } from '../src/errors/AppError.js';
import { parseHistoryQuery, parseSendInput } from '../src/validation/chat.js';

const db = createDatabase('mongodb://unused.invalid/unit_test');
const config = { accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure' as const, jwtSecret: randomBytes(32).toString('hex'), clientOrigins: ['http://localhost:5173'] };
const token = issueToken('507f1f77bcf86cd799439011', config.jwtSecret, 900).token;
const chat = { send: vi.fn(), stream: vi.fn(), history: vi.fn() };
const app = createApp({ config, users: db.users, chat,
  readiness: () => ({ databaseConnected: true, indexesInitialized: true }) });
afterEach(() => vi.clearAllMocks());

describe('API-02 strict chat input', () => {
  it.each([{}, null, [], { message: '' }, { message: '  ' }, { message: 1 }, { message: { $ne: null } },
    { message: 'a'.repeat(4001) }, { message: 'valid', conversationId: null }, { message: 'valid', conversationId: 'bad' },
    ...['userId', 'role', 'messages', 'model', 'prompt'].map((key) => ({ message: 'valid', [key]: 'forged' }))])(
    'rejects invalid input before database/provider service access', async (input) => {
      expect(() => parseSendInput(input)).toThrow();
      if (input === null) return;
      const result = await request(app).post('/chat/send').set('Authorization', 'Bearer ' + token).send(input);
      expect(result.status).toBe(400);
      expect(chat.send).not.toHaveBeenCalled();
    },
  );
  it('preserves internal whitespace and counts Unicode code points', () => {
    expect(parseSendInput({ message: '  a  b\n c  ' })).toEqual({ message: 'a  b\n c' });
    expect(parseSendInput({ message: '\u{1F600}'.repeat(4000) }).message).toHaveLength(8000);
  });
});
describe('API-03 history query validation', () => {
  it.each(['page=0', 'page=-1', 'page=1.5', 'page=9007199254740992', 'page=9007199254740991&limit=50',
    'limit=51', 'limit=0', 'page[]=1', 'page=1&page=2', 'limit=1&limit=2', 'userId=forged',
    'conversationId=bad', 'conversationId=', 'conversationId=507f1f77bcf86cd799439011&page=1',
    'conversationId=507f1f77bcf86cd799439011&limit=20', 'conversationId[]=507f1f77bcf86cd799439011',
    'conversationId=507f1f77bcf86cd799439011&conversationId=507f1f77bcf86cd799439011'])(
    'rejects %s without reads', async (query) => {
      const result = await request(app).get('/chat/history?' + query).set('Authorization', 'Bearer ' + token);
      expect(result.status).toBe(400);
      expect(result.body.error.code).toBe('VALIDATION_ERROR');
      expect(chat.history).not.toHaveBeenCalled();
    },
  );
  it('applies defaults, maximum limit and safe paging', () => {
    expect(parseHistoryQuery({})).toEqual({ mode: 'list', page: 1, limit: 20, skip: 0 });
    expect(parseHistoryQuery({ page: '2', limit: '50' })).toEqual({ mode: 'list', page: 2, limit: 50, skip: 50 });
  });
});
describe('API-01/04/05 route and security boundary', () => {
  it('authenticates before field validation and passes only verified ownership', async () => {
    expect((await request(app).post('/chat/send').send({ userId: 'forged' })).status).toBe(401);
    chat.send.mockResolvedValueOnce({ persisted: true });
    const result = await request(app).post('/chat/send').set('Authorization', 'Bearer ' + token).send({ message: ' Hello ' });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ success: true, data: { persisted: true } });
    expect(chat.send).toHaveBeenCalledWith('507f1f77bcf86cd799439011', { message: 'Hello' });
  });
  it('rejects non-JSON, malformed, compressed, oversized and escaped oversized input', async () => {
    const send = () => request(app).post('/chat/send').set('Authorization', 'Bearer ' + token);
    expect((await send().type('text').send('hello')).status).toBe(400);
    expect((await send().type('json').send('{')).body.error.code).toBe('INVALID_JSON');
    expect((await send().set('Content-Encoding', 'gzip').send({ message: 'hello' })).status).toBe(400);
    expect((await send().send({ message: 'x'.repeat(16384) })).status).toBe(413);
    expect((await send().type('json').send('{"message":"' + '\\u0061'.repeat(3000) + '"}')).status).toBe(413);
    expect((await request(app).get('/chat/history').set('Authorization', 'Bearer ' + token).send({ debug: true })).status).toBe(400);
    expect((await send().query({ debug: 1 }).send({ message: 'hello' })).status).toBe(400);
    expect(chat.send).not.toHaveBeenCalled();
    expect(chat.history).not.toHaveBeenCalled();
  });
  it('handles preflight without granting arbitrary origins or bypassing JWT', async () => {
    const preflight = (origin: string) => request(app).options('/chat/send').set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'authorization,content-type');
    expect((await preflight('http://localhost:5173')).status).toBe(204);
    expect((await preflight('https://evil.example')).headers['access-control-allow-origin']).toBeUndefined();
    expect((await request(app).get('/chat/history')).status).toBe(401);
    expect((await request(app).get('/api/chat/history')).status).toBe(404);
  });
});

describe('streaming chat route', () => {
  const saved = {
    conversationId: '507f1f77bcf86cd799439012', title: 'Hello', updatedAt: new Date().toISOString(),
    userMessage: { id: '507f1f77bcf86cd799439013', role: 'user', content: 'Hello', createdAt: new Date().toISOString() },
    assistantMessage: { id: '507f1f77bcf86cd799439014', role: 'assistant', content: 'Hi there', createdAt: new Date().toISOString() },
  };
  it('emits started, real deltas and committed in order after authenticated preparation', async () => {
    chat.stream.mockResolvedValueOnce({
      existingConversationId: null,
      run: async (onDelta: (text: string) => Promise<void>) => {
        await onDelta('Hi '); await onDelta('there'); return saved;
      },
    });
    const result = await request(app).post('/chat/send/stream').set('Authorization', 'Bearer ' + token).send({ message: ' Hello ' });
    expect(result.status).toBe(200);
    expect(result.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(result.headers['cache-control']).toContain('no-store');
    expect(result.text.indexOf('event: started')).toBeLessThan(result.text.indexOf('event: delta'));
    expect(result.text.indexOf('event: delta')).toBeLessThan(result.text.indexOf('event: committed'));
    expect(result.text).toContain('data: {"text":"Hi "}');
    expect(result.text).toContain(JSON.stringify(saved));
    expect(chat.stream).toHaveBeenCalledWith('507f1f77bcf86cd799439011', { message: 'Hello' });
  });
  it('uses JSON errors before streaming and safe SSE errors after streaming starts', async () => {
    chat.stream.mockRejectedValueOnce(new AppError(404, 'CONVERSATION_NOT_FOUND', 'The conversation was not found.'));
    const before = await request(app).post('/chat/send/stream').set('Authorization', 'Bearer ' + token)
      .send({ message: 'Hello', conversationId: '507f1f77bcf86cd799439099' });
    expect(before.status).toBe(404);
    expect(before.headers['content-type']).toMatch(/^application\/json/);
    chat.stream.mockResolvedValueOnce({
      existingConversationId: null,
      run: async () => { throw new AppError(503, 'DATABASE_UNAVAILABLE', 'The database is not ready.'); },
    });
    const after = await request(app).post('/chat/send/stream').set('Authorization', 'Bearer ' + token).send({ message: 'Hello' });
    expect(after.status).toBe(200);
    expect(after.text).toContain('event: error');
    expect(after.text).toContain('"code":"DATABASE_UNAVAILABLE"');
    expect(after.text).toContain('"outcome":"unknown"');
  });
  it('authenticates and validates before creating a stream operation', async () => {
    expect((await request(app).post('/chat/send/stream').send({ message: 'Hello' })).status).toBe(401);
    expect((await request(app).post('/chat/send/stream').set('Authorization', 'Bearer ' + token).send({ message: '' })).status).toBe(400);
    expect(chat.stream).not.toHaveBeenCalled();
  });
});
