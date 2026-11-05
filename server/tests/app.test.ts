import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDatabase } from '../src/database/database.js';
import { randomBytes } from 'node:crypto';
import type { Readiness } from '../src/controllers/healthController.js';

const users = createDatabase('mongodb://unused.invalid/test').users;
const config = { accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure' as const, jwtSecret: randomBytes(32).toString('hex'), clientOrigins: ['http://localhost:5173', 'https://frontend.example.com'] };

afterEach(() => vi.restoreAllMocks());

describe('T-01 HTTP infrastructure', () => {
  it('defaults to unavailable when the database is not ready', async () => {
    const response = await request(createApp({ config, users })).get('/health');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'DATABASE_UNAVAILABLE', message: 'The database is not ready.' },
    });
  });

  it.each([
    { databaseConnected: false, indexesInitialized: false },
    { databaseConnected: true, indexesInitialized: false },
    { databaseConnected: false, indexesInitialized: true },
  ])('requires both readiness conditions: %j', async (state) => {
    const response = await request(createApp({ config, users, readiness: () => state })).get('/health');
    expect(response.status).toBe(503);
  });

  it('reflects readiness and connection loss without caching an earlier result', async () => {
    let state: Readiness = { databaseConnected: true, indexesInitialized: true };
    const app = createApp({ config, users, readiness: () => state });
    const healthy = await request(app).get('/health');
    expect(healthy.status).toBe(200);
    expect(healthy.body).toEqual({ success: true, data: { status: 'ok' } });
    state = { databaseConnected: false, indexesInitialized: true };
    expect((await request(app).get('/health')).status).toBe(503);
  });

  it('exposes no server identity and prevents caching', async () => {
    const response = await request(createApp({ config, users })).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('handles an allowlisted auth-header preflight before future route authentication', async () => {
    const response = await request(createApp({ config, users }))
      .options('/chat/send')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'authorization,content-type');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-headers']).toBe('Authorization,Content-Type,X-CSRF-Protection');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant CORS permission to arbitrary origins', async () => {
    const response = await request(createApp({ config, users }))
      .options('/chat/send')
      .set('Origin', 'https://frontend.example.com.evil.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['/health?debug=1', '/health?debug[]=1'])('rejects health queries: %s', async (path) => {
    const response = await request(createApp({ config, users })).get(path);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a health request body', async () => {
    const response = await request(createApp({ config, users })).get('/health').send({ debug: true });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('normalizes malformed JSON and oversized payloads', async () => {
    const app = createApp({ config, users });
    const malformed = await request(app).post('/unknown').set('Content-Type', 'application/json').send('{');
    expect(malformed.status).toBe(400);
    expect(malformed.body.error.code).toBe('INVALID_JSON');
    const oversized = await request(app).post('/unknown').send({ text: 'a'.repeat(16 * 1024) });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects compressed JSON with the documented safe status', async () => {
    const response = await request(createApp({ config, users })).post('/unknown')
      .set('Content-Type', 'application/json').set('Content-Encoding', 'gzip').send('{}');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('uses a safe envelope for unknown routes and does not add an /api alias', async () => {
    const response = await request(createApp({ config, users })).get('/api/health');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false, error: { code: 'NOT_FOUND', message: 'The requested endpoint does not exist.' },
    });
  });

  it('does not expose or log unexpected exception details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp({ config, users, readiness: () => { throw new Error('synthetic-secret-marker'); } });
    const response = await request(app).get('/health');
    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' },
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('synthetic-secret-marker');
  });
});
