import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { validateServerEnv } from '../src/config/env.js';
import { validEnvironment } from './fixtures.js';
import { issueToken, verifyToken } from '../src/services/tokens.js';

describe('AUTH-P duration and cookie configuration', () => {
  it('defaults to 15 minutes and one day, and signs from the parsed access duration', () => {
    const config = validateServerEnv(validEnvironment());
    expect(config.accessSeconds).toBe(900);
    expect(config.refreshSeconds).toBe(86400);
    const issued = issueToken('507f1f77bcf86cd799439011', config.jwtSecret, config.accessSeconds);
    const decoded = jwt.decode(issued.token) as jwt.JwtPayload;
    expect(decoded.exp! - decoded.iat!).toBe(900);
    expect(issued.expiresAt).toBe(new Date(decoded.exp! * 1000).toISOString());
    expect(verifyToken(issued.token, config.jwtSecret).userId).toBe(decoded.sub);
  });
  it.each(['0m', '-1h', '1.5h', '1w', '15', '', ' 1h', '1H', '999999999999999999999d'])('rejects invalid duration %s', (value) => {
    for (const key of ['JWT_ACCESS_EXPIRES_IN', 'JWT_REFRESH_EXPIRES_IN']) {
      expect(() => validateServerEnv({ ...validEnvironment(), [key]: value })).toThrow(key);
    }
  });
  it.each([['JWT_ACCESS_EXPIRES_IN', '61m'], ['JWT_REFRESH_EXPIRES_IN', '31d']])('rejects excessive %s', (key, value) => {
    expect(() => validateServerEnv({ ...validEnvironment(), [key!]: value! })).toThrow(key!);
  });
  it('accepts documented units, short test durations and rejects a refresh lifetime shorter than access', () => {
    expect(validateServerEnv({ ...validEnvironment(), JWT_ACCESS_EXPIRES_IN: '3s', JWT_REFRESH_EXPIRES_IN: '1h' }))
      .toMatchObject({ accessSeconds: 3, refreshSeconds: 3600 });
    expect(validateServerEnv({ ...validEnvironment(), JWT_ACCESS_EXPIRES_IN: '1h', JWT_REFRESH_EXPIRES_IN: '30d' }))
      .toMatchObject({ accessSeconds: 3600, refreshSeconds: 2592000 });
    expect(() => validateServerEnv({ ...validEnvironment(), JWT_REFRESH_EXPIRES_IN: '1s' })).toThrow('JWT_REFRESH_EXPIRES_IN');
  });
  it('allows insecure cookies only in explicitly selected loopback environments', () => {
    expect(validateServerEnv({ ...validEnvironment(), AUTH_COOKIE_MODE: 'localhost' }).cookieMode).toBe('localhost');
    expect(() => validateServerEnv({ ...validEnvironment(), AUTH_COOKIE_MODE: 'false' })).toThrow('AUTH_COOKIE_MODE');
    expect(() => validateServerEnv({ ...validEnvironment(), AUTH_COOKIE_MODE: 'localhost', CLIENT_ORIGINS: 'https://app.example.com' }))
      .toThrow('AUTH_COOKIE_MODE');
  });
});
