import { validateClientEnv } from './validateEnv';

export const env = validateClientEnv(import.meta.env, import.meta.env.PROD);
