import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import express from 'express';
import { parseAuthInput } from '../src/validation/auth.js';
import { issueToken, verifyToken } from '../src/services/tokens.js';
import { createDatabase } from '../src/database/database.js';
import { createApp } from '../src/app.js';
import { authenticate } from '../src/middleware/authenticate.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { validateServerEnv } from '../src/config/env.js';
import { validEnvironment } from './fixtures.js';

const secret = randomBytes(32).toString('hex');
const id = '507f1f77bcf86cd799439011';
afterEach(() => vi.restoreAllMocks());

describe('AUTH-04 strict credential validation', () => {
  it.each(['12345678', 'a'.repeat(72), '\u{1F600}'.repeat(18), ' pass word '])('accepts valid boundaries without trimming passwords', (password) => {
    expect(parseAuthInput({ email: ' A@Example.com ', password })).toEqual({ email: 'a@example.com', password });
  });
  it.each(['1234567', 'a'.repeat(73), '\u{1F600}'.repeat(19), '\u{1F600}'.repeat(7)])('rejects character or byte overflow', (password) => {
    expect(() => parseAuthInput({ email: 'a@example.com', password })).toThrow();
  });
  it.each([null, [], {}, { email: { $ne: null }, password: '12345678' },
    { email: 'bad', password: '12345678' }, { email: 'a@example.com', password: ['12345678'] },
    { email: 'a@example.com', password: '12345678', userId: id },
    { email: 'a@example.com', password: '12345678', name: 'Unapproved' }])('rejects invalid shape and forged fields', (body) => {
    expect(() => parseAuthInput(body)).toThrow();
  });
});

describe('AUTH-01/06/07 signed identity', () => {
  it('issues configured HS256 tokens and trusts only the signed subject', async () => {
    const issued = issueToken(id, secret, 900);
    const claims = jwt.verify(issued.token, secret);
    expect(claims).toMatchObject({ sub: id, iss: 'customer-support-api', aud: 'customer-support-web' });
    if (typeof claims === 'string' || !claims.iat || !claims.exp) throw new Error('Missing claims');
    expect(claims.exp - claims.iat).toBe(900);
    expect(issued.expiresAt).toBe(new Date(claims.exp * 1000).toISOString());
    const app = express();
    app.use(authenticate(secret));
    app.get('/identity', (req, res) => res.json(req.auth));
    app.use(errorHandler);
    const response = await request(app).get('/identity?userId=forged').set('Authorization', 'Bearer ' + issued.token);
    expect(response.body).toEqual({ userId: id });
    expect(Object.isFrozen(verifyToken(issued.token, secret))).toBe(true);
  });
  it.each([
    { iss: 'wrong' }, { aud: 'wrong' }, { aud: ['customer-support-web'] }, { sub: 'invalid' },
    { exp: 1 }, { exp: undefined }, { iat: undefined }, { iat: Math.floor(Date.now() / 1000) + 100 },
  ])('rejects invalid required claims', (override) => {
    const now = Math.floor(Date.now() / 1000);
    const payload = { sub: id, iss: 'customer-support-api', aud: 'customer-support-web', iat: now, exp: now + 3600, ...override };
    // Omitting iat requires noTimestamp because jsonwebtoken otherwise inserts it.
    const token = jwt.sign(JSON.parse(JSON.stringify(payload)) as object, secret, {
      algorithm: 'HS256', ...(override.iat === undefined && 'iat' in override ? { noTimestamp: true } : {}),
    });
    expect(() => verifyToken(token, secret)).toThrow('Authentication is required.');
  });
  it('rejects tampering, wrong keys and alternate algorithms', () => {
    const token = issueToken(id, secret, 900).token;
    expect(() => verifyToken(token + 'x', secret)).toThrow();
    expect(() => verifyToken(token, randomBytes(32).toString('hex'))).toThrow();
    expect(() => verifyToken(jwt.sign({ sub: id }, secret, { algorithm: 'HS384' }), secret)).toThrow();
    expect(() => verifyToken('eyJhbGciOiJub25lIn0.e30.', secret)).toThrow();
  });
  it('honors previously issued expiry independently of a newly shortened lifetime', () => {
    const old = issueToken(id, secret, 3600);
    const current = issueToken(id, secret, 30);
    expect(verifyToken(old.token, secret).userId).toBe(id);
    expect(verifyToken(current.token, secret).userId).toBe(id);
    expect(Date.parse(old.expiresAt)).toBeGreaterThan(Date.parse(current.expiresAt));
  });
  it('protects both future history modes and send without implementing chat', async () => {
    const db = createDatabase('mongodb://unused.invalid/unit_test');
    const app = createApp({ users: db.users, config: { jwtSecret: secret, clientOrigins: ['http://localhost:5173'], accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure' } });
    for (const path of ['/chat/history', '/chat/history?conversationId=' + id, '/chat/send']) {
      for (const header of ['', 'Basic abc', 'Bearer broken', 'Bearer ' + issueToken(id, 'wrong-secret', 900).token,
        'Bearer ' + issueToken(id, secret, 900).token + 'tampered',
        'Bearer ' + jwt.sign({ sub: id, iss: 'customer-support-api', aud: 'customer-support-web', exp: 1 }, secret)]) {
        const req = path === '/chat/send' ? request(app).post(path).send({ message: 'hello' }) : request(app).get(path);
        const response = await req.set('Authorization', header);
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe('UNAUTHORIZED');
      }
    }
    expect((await request(app).get('/chat/history').set('Authorization', 'Bearer ' + issueToken(id, secret, 900).token)).status).toBe(404);
  });
});

describe('API-06 readiness and safe database errors', () => {
  it('rejects authentication promptly when database/indexes are unavailable', async () => {
    const db = createDatabase('mongodb://unused.invalid/unit_test');
    const create = vi.spyOn(db.users, 'create');
    const app = createApp({ users: db.users, config: { jwtSecret: secret, clientOrigins: ['http://localhost:5173'], accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure' } });
    const result = await request(app).post('/auth/signup').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: 'a@example.com', password: '12345678' });
    expect(result.status).toBe(503);
    expect(create).not.toHaveBeenCalled();
  });
  it('sanitizes duplicate, database and unexpected errors', async () => {
    const db = createDatabase('mongodb://unused.invalid/unit_test');
    const app = createApp({ users: db.users, config: { jwtSecret: secret, clientOrigins: ['http://localhost:5173'], accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure' },
      readiness: () => ({ databaseConnected: true, indexesInitialized: true }) });
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const spy = vi.spyOn(db.users, 'findOne');
    for (const [failure, status, code] of [
      [Object.assign(new Error('secret-marker'), { code: 11000 }), 409, 'EMAIL_EXISTS'],
      [Object.assign(new Error('secret-marker'), { name: 'MongoNetworkError' }), 503, 'DATABASE_UNAVAILABLE'],
      [new Error('secret-marker'), 500, 'INTERNAL_ERROR'],
    ] as const) {
      spy.mockImplementationOnce(() => { throw failure; });
      const result = await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').set('X-CSRF-Protection', '1').send({ email: 'a@example.com', password: '12345678' });
      expect(result.status).toBe(status);
      expect(result.body.error.code).toBe(code);
      expect(JSON.stringify(result.body)).not.toContain('secret-marker');
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-marker');
  });
  it('initializes indexes before readiness and fails closed on index error', async () => {
    const db = createDatabase('mongodb://unused.invalid/unit_test');
    vi.spyOn(db.connection, 'openUri').mockResolvedValue(db.connection);
    vi.spyOn(db.connection, 'close').mockResolvedValue();
    vi.spyOn(db.users, 'createIndexes').mockRejectedValue(new Error('secret-marker'));
    vi.spyOn(db.conversations, 'createIndexes').mockResolvedValue(undefined);
    vi.spyOn(db.refreshSessions, 'createIndexes').mockResolvedValue(undefined);
    await expect(db.initialize()).rejects.toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    expect(db.readiness()).toEqual({ databaseConnected: false, indexesInitialized: false });
    expect(db.connection.close).toHaveBeenCalled();
  });
  it('bounds an unreachable initial connection and exposes no URI', async () => {
    const db = createDatabase('mongodb://127.0.0.1:1/unreachable_test');
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const started = Date.now();
    await expect(db.initialize()).rejects.toMatchObject({ status: 503, code: 'DATABASE_UNAVAILABLE' });
    expect(Date.now() - started).toBeLessThan(12000);
    expect(db.readiness().databaseConnected).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain('mongodb');
  }, 15000);
  it('refuses a test target sharing the configured application database name', () => {
    const values = { ...validEnvironment(), NODE_ENV: 'test',
      MONGODB_URI: 'mongodb://host/shared_test', MONGODB_TEST_URI: 'mongodb://other/shared_test' };
    expect(() => validateServerEnv(values)).toThrow('different database name');
  });
});
