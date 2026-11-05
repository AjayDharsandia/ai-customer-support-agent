import { randomBytes } from 'node:crypto';

interface FixtureEnvironment extends Record<string, string> {
  NODE_ENV: string;
  MONGODB_URI: string;
  JWT_SECRET: string;
  OPENROUTER_API_KEY: string;
  CLIENT_ORIGINS: string;
}

export function validEnvironment(): FixtureEnvironment {
  return {
    NODE_ENV: 'development',
    MONGODB_URI: 'mongodb+srv://fixture:' + randomBytes(16).toString('hex') + '@cluster.mongodb.net/customer_support',
    JWT_SECRET: randomBytes(32).toString('hex'),
    OPENROUTER_API_KEY: randomBytes(32).toString('hex'),
    CLIENT_ORIGINS: 'http://localhost:5173,http://localhost:8080',
  };
}
