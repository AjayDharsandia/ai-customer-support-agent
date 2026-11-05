import axios from 'axios';
import { env } from '../config/env';

export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 45_000,
  withCredentials: true,
  headers: { Accept: 'application/json' },
});
