import { describe, expect, it } from 'vitest';
import { ConfigurationError, validateServerEnv } from '../src/config/env.js';
import { validEnvironment } from './fixtures.js';

describe('server environment validation', () => {
  it('validates required values and applies documented defaults', () => {
    const values = validEnvironment();
    expect(validateServerEnv(values)).toEqual({
      nodeEnv: 'development', port: 5000, accessSeconds: 900, refreshSeconds: 86400, cookieMode: 'secure',
      clientOrigins: ['http://localhost:5173', 'http://localhost:8080'],
      databaseUri: values.MONGODB_URI, jwtSecret: values.JWT_SECRET,
      openRouterApiKey: values.OPENROUTER_API_KEY, openRouterModel: 'openrouter/free',
    });
  });

  it.each(['MONGODB_URI', 'JWT_SECRET', 'OPENROUTER_API_KEY', 'CLIENT_ORIGINS'])(
    'fails when %s is absent', (key) => {
      const values = validEnvironment();
      delete values[key];
      expect(() => validateServerEnv(values)).toThrow(key);
    },
  );

  it.each([
    ['MONGODB_URI', 'https://example.com/database'],
    ['MONGODB_URI', 'mongodb+srv://cluster.mongodb.net'],
    ['MONGODB_URI', 'mongodb+srv://<username>:<password>@<cluster>.mongodb.net/customer_support'],
    ['JWT_SECRET', 'short'],
    ['JWT_SECRET', 'replace-with-a-random-secret-of-at-least-32-bytes'],
    ['JWT_SECRET', 'a'.repeat(64)],
    ['OPENROUTER_API_KEY', 'replace-with-your-openrouter-api-key'],
    ['PORT', '0'], ['PORT', '65536'], ['PORT', '5.5'], ['PORT', 'NaN'], ['PORT', ''],
    ['NODE_ENV', 'staging'],
    ['CLIENT_ORIGINS', '*'],
    ['CLIENT_ORIGINS', 'https://*.example.com'],
    ['CLIENT_ORIGINS', 'http://localhost:5173/path'],
    ['CLIENT_ORIGINS', 'http://localhost:5173,'],
    ['CLIENT_ORIGINS', 'https://user:password@example.com'],
    ['OPENROUTER_MODEL', ''],
    ['OPENROUTER_MODEL', 'not a model'],
  ])('rejects invalid %s values', (key, value) => {
    expect(() => validateServerEnv({ ...validEnvironment(), [key]: value })).toThrow(key);
  });

  it('reports only safe configuration guidance, not supplied secrets', () => {
    const values = { ...validEnvironment(), MONGODB_URI: 'invalid-private-connection-marker' };
    try {
      validateServerEnv(values);
      expect.unreachable('Invalid configuration must throw');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('MONGODB_URI');
      expect(message).not.toContain(values.MONGODB_URI);
      expect(message).not.toContain(values.JWT_SECRET);
      expect(message).not.toContain(values.OPENROUTER_API_KEY);
    }
  });

  it('honors the supplied server port and model', () => {
    const config = validateServerEnv({ ...validEnvironment(), PORT: '10000', OPENROUTER_MODEL: 'provider/model:free' });
    expect(config.port).toBe(10000);
    expect(config.openRouterModel).toBe('provider/model:free');
  });

  it('requires HTTPS for remote production origins but permits local Docker HTTP', () => {
    const values = { ...validEnvironment(), NODE_ENV: 'production', CLIENT_ORIGINS: 'http://frontend.example.com' };
    expect(() => validateServerEnv(values)).toThrow('CLIENT_ORIGINS');
    expect(validateServerEnv({ ...values, CLIENT_ORIGINS: 'https://frontend.example.com' }).nodeEnv).toBe('production');
    expect(validateServerEnv({ ...values, CLIENT_ORIGINS: 'http://localhost:8080' }).nodeEnv).toBe('production');
  });

  it('refuses to fall back to the app URI for a test environment', () => {
    expect(() => validateServerEnv({ ...validEnvironment(), NODE_ENV: 'test' })).toThrow('MONGODB_TEST_URI');
  });

  it('requires a dedicated test database and selects only that URI', () => {
    const values = { ...validEnvironment(), NODE_ENV: 'test' };
    expect(() => validateServerEnv({ ...values, MONGODB_TEST_URI: values.MONGODB_URI })).toThrow('ending in _test');
    const testUri = 'mongodb+srv://cluster.mongodb.net/customer_support_test';
    expect(validateServerEnv({ ...values, MONGODB_TEST_URI: testUri }).databaseUri).toBe(testUri);
  });
});
