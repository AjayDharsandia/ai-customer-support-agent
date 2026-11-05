import { parseAuthConfig } from './auth.js';
import type { AuthConfig } from './auth.js';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { config as loadDotEnv } from 'dotenv';

type Environment = Record<string, string | undefined>;
export interface ServerConfig extends AuthConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  clientOrigins: string[];
  databaseUri: string;
  jwtSecret: string;
  openRouterApiKey: string;
  openRouterModel: string;
}

export class ConfigurationError extends Error {
  constructor(issues: string[]) {
    super('Invalid configuration: ' + issues.join('; '));
    this.name = 'ConfigurationError';
  }
}

function isPlaceholder(value: string): boolean {
  return /[<>]|replace[-_ ]?with|change[-_ ]?me|your[-_ ]|placeholder/i.test(value);
}

function validOrigin(value: string, production: boolean): boolean {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    return ['http:', 'https:'].includes(url.protocol) && !url.hostname.includes('*') &&
      url.origin === value && url.username === '' && url.password === '' &&
      (!production || local || url.protocol === 'https:');
  } catch {
    return false;
  }
}

function databaseName(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol) || !url.hostname) return undefined;
    const name = decodeURIComponent(url.pathname.slice(1));
    if (!name || /[\s/\\.\0"$]/u.test(name)) return undefined;
    return name;
  } catch {
    return undefined;
  }
}

export function validateServerEnv(values: Environment): ServerConfig {
  const issues: string[] = [];
  const required = (name: string): string => {
    const value = values[name] ?? '';
    if (!value.trim() || value !== value.trim() || isPlaceholder(value)) {
      issues.push(name + ' is required and must not contain an example placeholder or outer whitespace');
    }
    return value;
  };

  const mode = values.NODE_ENV ?? 'development';
  const nodeEnv = mode === 'production' || mode === 'test' ? mode : 'development';
  if (!['development', 'test', 'production'].includes(mode)) {
    issues.push('NODE_ENV must be development, test, or production');
  }

  const portText = values.PORT ?? '5000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('PORT must be an integer between 1 and 65535');
  }

  const clientOrigins = required('CLIENT_ORIGINS').split(',').map((origin) => origin.trim());
  if (clientOrigins.some((origin) => !validOrigin(origin, nodeEnv === 'production'))) {
    issues.push('CLIENT_ORIGINS must contain exact HTTP(S) origins; deployed origins require HTTPS');
  }

  // Selecting a test environment must never silently target application data.
  const uriVariable = nodeEnv === 'test' ? 'MONGODB_TEST_URI' : 'MONGODB_URI';
  const databaseUri = required(uriVariable);
  const name = databaseName(databaseUri);
  if (!name) issues.push(uriVariable + ' must be a MongoDB URI with a database name');
  if (nodeEnv === 'test' && !name?.endsWith('_test')) {
    issues.push('MONGODB_TEST_URI must name a dedicated database ending in _test');
  }
  if (nodeEnv === 'test' && name && name === databaseName(values.MONGODB_URI ?? '')) {
    issues.push('MONGODB_TEST_URI must use a different database name from MONGODB_URI');
  }

  const jwtSecret = required('JWT_SECRET');
  if (Buffer.byteLength(jwtSecret, 'utf8') < 32 || /^(.)\1+$/u.test(jwtSecret)) {
    issues.push('JWT_SECRET must contain at least 32 bytes from a cryptographically random source');
  }
  const openRouterApiKey = required('OPENROUTER_API_KEY');
  const openRouterModel = values.OPENROUTER_MODEL ?? 'openrouter/free';
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.:/-]+$/.test(openRouterModel)) {
    issues.push('OPENROUTER_MODEL must be a provider/model identifier');
  }

  let auth: AuthConfig;
  try { auth = parseAuthConfig(values, clientOrigins); }
  catch (error) { throw new ConfigurationError([...issues, error instanceof Error ? error.message : 'Invalid authentication configuration']); }
  if (issues.length > 0) throw new ConfigurationError(issues);
  return {
    ...auth, nodeEnv, port, clientOrigins: [...new Set(clientOrigins)], databaseUri,
    jwtSecret, openRouterApiKey, openRouterModel,
  };
}

export function loadServerConfig(): ServerConfig {
  // Works from src/config and dist/config, independent of the invoking directory.
  const result = loadDotEnv({
    path: fileURLToPath(new URL('../../.env', import.meta.url)),
    quiet: true,
  });
  if (result.error && 'code' in result.error && result.error.code !== 'ENOENT') {
    throw new ConfigurationError(['server/.env could not be read']);
  }
  return validateServerEnv(process.env);
}
