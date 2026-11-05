import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { validateServerEnv } from '../../src/config/env.js';
import { createDatabase } from '../../src/database/database.js';
import { createApp } from '../../src/app.js';

loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const config = validateServerEnv({ ...process.env, NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'),
  OPENROUTER_API_KEY: 'synthetic-provider-no-calls', CLIENT_ORIGINS: 'http://localhost:5173',
  AUTH_COOKIE_MODE: 'localhost', JWT_ACCESS_EXPIRES_IN: '2m', JWT_REFRESH_EXPIRES_IN: '1h' });
const db = createDatabase(config.databaseUri);
const app = createApp({ config, users: db.users, readiness: db.readiness });
const emails: string[] = [];
const password = 'Synthetic-password-123';
let ready = false;
type Response = Awaited<ReturnType<ReturnType<typeof request>['post']>>;
function cookie(response: Response) {
  const values = response.headers['set-cookie'] as unknown as string[];
  return values[0]!.split(';')[0]!;
}
const post = (path: string, credential?: string) => {
  const call = request(app).post('/auth/' + path).set('Origin', config.clientOrigins[0]!).set('X-CSRF-Protection', '1');
  return credential ? call.set('Cookie', credential) : call;
};
async function signup() {
  const email = 'authp-' + randomUUID() + '@example.test'; emails.push(email);
  const response = await post('signup').send({ email, password });
  expect(response.status).toBe(201);
  return { response, email, credential: cookie(response), userId: response.body.data.user.id as string };
}
beforeAll(async () => { await db.initialize(); ready = true; });
afterAll(async () => {
  try {
    if (ready) {
      const users = await db.users.find({ email: { $in: emails } }).select('_id');
      await db.refreshSessions.deleteMany({ userId: { $in: users.map(u => u._id) } });
      await db.users.deleteMany({ _id: { $in: users.map(u => u._id) } });
      expect(await db.users.countDocuments({ email: { $in: emails } })).toBe(0);
    }
  } finally { await db.close(); }
});
describe('Persistent authentication sessions on dedicated Atlas test database', () => {
  it('signup returns compatible JSON, configured JWT, hashed-only session and bounded HttpOnly cookie', async () => {
    const { response, credential, userId } = await signup();
    expect(Object.keys(response.body.data).sort()).toEqual(['expiresAt', 'token', 'user']);
    const claims = jwt.decode(response.body.data.token as string) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(120);
    const record = await db.refreshSessions.findOne({ userId }).lean();
    expect(record).toBeTruthy();
    expect(record!.expiresAt.getTime() - record!.createdAt.getTime()).toBe(3600000);
    const opaque = credential.split('=')[1]!;
    expect(record!.tokenHash).toBe(createHash('sha256').update(Buffer.from(opaque, 'base64url')).digest('hex'));
    expect(JSON.stringify(record)).not.toContain(opaque);
    const header = String(response.headers['set-cookie']);
    expect(header).toContain('HttpOnly'); expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/'); expect(header).not.toContain('Domain=');
    expect(header).not.toContain('; Secure');
    const age = Number(/Max-Age=(\d+)/.exec(header)?.[1]);
    expect(age).toBeGreaterThanOrEqual(3597); expect(age).toBeLessThanOrEqual(3600);
    expect(response.headers['cache-control']).toBe('no-store');
    const indexes = await db.refreshSessions.collection.indexes();
    expect(indexes.some(i => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);
    expect(indexes.some(i => i.key.tokenHash === 1 && i.unique)).toBe(true);
  });
  it('login issues both credentials and refresh rotates without extending absolute expiry', async () => {
    const account = await signup();
    const login = await post('login', account.credential).send({ email: account.email, password });
    expect(login.status).toBe(200);
    expect((await post('refresh', account.credential).send({})).status).toBe(401);
    const before = await db.refreshSessions.findOne({ userId: account.userId, revokedAt: null });
    const refreshed = await post('refresh', cookie(login)).send({});
    expect(refreshed.status).toBe(200);
    expect(cookie(refreshed)).not.toBe(cookie(login));
    expect(refreshed.body.data.user.id).toBe(account.userId);
    const after = await db.refreshSessions.findById(before!._id);
    expect(after!.expiresAt).toEqual(before!.expiresAt);
    expect(after!.spent).toHaveLength(1);
    const old = await post('refresh', cookie(login)).send({});
    expect(old.status).toBe(409); expect(old.headers['set-cookie']).toBeUndefined();
  });
  it('concurrent refresh has one winner and harmless conflicts, then late reuse revokes the entire session', async () => {
    const account = await signup();
    const results = await Promise.all(Array.from({ length: 4 }, () => post('refresh', account.credential).send({})));
    expect(results.map(r => r.status).sort()).toEqual([200, 409, 409, 409]);
    const winner = results.find(r => r.status === 200)!;
    const record = await db.refreshSessions.findOne({ userId: account.userId });
    expect(record!.revokedAt).toBeNull();
    await db.refreshSessions.collection.updateOne({ _id: record!._id }, { $set: { 'spent.0.usedAt': new Date(Date.now() - 11000) } });
    expect((await post('refresh', account.credential).send({})).status).toBe(401);
    expect((await post('refresh', cookie(winner)).send({})).status).toBe(401);
    expect((await db.refreshSessions.findById(record!._id))!.revokedAt).toBeTruthy();
  });
  it('logout revokes current/consumed credentials, clears matching attributes and is idempotent', async () => {
    const account = await signup();
    const rotated = await post('refresh', account.credential).send({});
    const loggedOut = await post('logout', account.credential).send({});
    expect(loggedOut.status).toBe(200);
    expect(loggedOut.body).toEqual({ success: true, data: { loggedOut: true } });
    expect(String(loggedOut.headers['set-cookie'])).toContain('Expires=Thu, 01 Jan 1970');
    for (const attribute of ['Path=/', 'HttpOnly', 'SameSite=Lax']) {
      expect(String(loggedOut.headers['set-cookie'])).toContain(attribute);
    }
    expect((await post('refresh', cookie(rotated)).send({})).status).toBe(401);
    expect((await post('logout').send({})).status).toBe(200);
    expect((await post('logout', 'csa-refresh-local=invalid').send({})).status).toBe(200);
  });
  it('rejects missing, malformed, unknown and expired credentials independently of TTL cleanup', async () => {
    for (const credential of [undefined, 'csa-refresh-local=bad', 'csa-refresh-local=' + randomBytes(64).toString('base64url')]) {
      expect((await post('refresh', credential).send({})).status).toBe(401);
    }
    const account = await signup();
    await db.refreshSessions.collection.updateOne({ userId: (await db.users.findById(account.userId))!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await post('refresh', account.credential).send({})).status).toBe(401);
  });
  it('does not revoke a session for an unknown secret or let a credential change ownership', async () => {
    const a = await signup(); const b = await signup();
    const opaque = Buffer.from(a.credential.split('=')[1]!, 'base64url');
    randomBytes(32).copy(opaque,32);
    expect((await post('refresh','csa-refresh-local='+opaque.toString('base64url')).send({})).status).toBe(401);
    expect((await post('refresh',a.credential).send({})).body.data.user.id).toBe(a.userId);
    expect((await post('refresh',b.credential).send({})).body.data.user.id).toBe(b.userId);
  });
  it('rejects untrusted/missing origins, absent CSRF headers, cross-site metadata and unexpected bodies', async () => {
    const account = await signup();
    for (const endpoint of ['refresh','logout','login','signup']) {
      expect((await request(app).post('/auth/'+endpoint).send({})).status).toBe(403);
      expect((await request(app).post('/auth/'+endpoint).set('Origin','https://evil.example').set('X-CSRF-Protection','1').send({})).status).toBe(403);
      expect((await request(app).post('/auth/'+endpoint).set('Origin',config.clientOrigins[0]!).send({})).status).toBe(403);
    }
    expect((await post('refresh',account.credential).set('Sec-Fetch-Site','cross-site').send({})).status).toBe(403);
    expect((await post('refresh',account.credential).send({ userId: account.userId })).status).toBe(400);
    expect((await post('refresh',account.credential).send({})).status).toBe(200);
  });
  it('uses secure host-only __Host- cookies for HTTPS mode', async () => {
    const secure = createApp({ config: { ...config, cookieMode: 'secure' }, users: db.users, readiness: db.readiness });
    const account = await signup();
    const response = await request(secure).post('/auth/login').set('Origin',config.clientOrigins[0]!).set('X-CSRF-Protection','1')
      .send({email:account.email,password});
    expect(String(response.headers['set-cookie'])).toMatch(/__Host-csa-refresh=.*Path=\/;.*HttpOnly; Secure; SameSite=Lax/);
    expect(String(response.headers['set-cookie'])).not.toContain('Domain=');
  });
  it('new configuration changes access expiry but cannot extend an existing refresh session', async () => {
    const account = await signup();
    const before = await db.refreshSessions.findOne({ userId: account.userId });
    const changed = createApp({ config: { ...config, accessSeconds: 30, refreshSeconds: 86400 }, users: db.users, readiness: db.readiness });
    const response = await request(changed).post('/auth/refresh').set('Origin',config.clientOrigins[0]!).set('X-CSRF-Protection','1')
      .set('Cookie',account.credential).send({});
    expect(response.status).toBe(200);
    const claims = jwt.decode(response.body.data.token as string) as jwt.JwtPayload;
    expect(claims.exp!-claims.iat!).toBe(30);
    expect((await db.refreshSessions.findById(before!._id))!.expiresAt).toEqual(before!.expiresAt);
  });
  it('returns safe database failures without issuing credentials or claiming logout succeeded', async () => {
    const account = await signup();
    const failure = Object.assign(new Error('private-error-marker'), { name: 'MongoNetworkError' });
    const rotation = vi.spyOn(db.refreshSessions, 'findOneAndUpdate').mockImplementationOnce(() => { throw failure; });
    try {
      const response = await post('refresh', account.credential).send({});
      expect(response.status).toBe(503);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain('private-error-marker');
    } finally { rotation.mockRestore(); }
    const revoke = vi.spyOn(db.refreshSessions, 'updateOne').mockImplementationOnce(() => { throw failure; });
    try {
      const response = await post('logout', account.credential).send({});
      expect(response.status).toBe(503);
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally { revoke.mockRestore(); }
    expect((await post('refresh', account.credential).send({})).status).toBe(200);
  });
  it('bounds rotation metadata and requires login at capacity', async () => {
    const account = await signup();
    const record = await db.refreshSessions.findOne({ userId: account.userId });
    await db.refreshSessions.collection.updateOne({ _id: record!._id }, { $set: {
      spent: Array.from({ length: 2048 }, () => ({ hash: randomBytes(32).toString('hex'), usedAt: new Date() })),
    } });
    expect((await post('refresh', account.credential).send({})).status).toBe(401);
    expect((await db.refreshSessions.findById(record!._id))!.revokedAt).toBeTruthy();
  });
});
