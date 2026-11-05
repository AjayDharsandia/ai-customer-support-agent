import { AppError } from '../errors/AppError.js';
import type { AuthRequest } from '../types/api.js';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
export function isValidEmail(email: string): boolean {
  return Array.from(email).length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}
export function parseAuthInput(body: unknown): AuthRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please check the request.');
  }
  const values = Object.entries(body);
  if (values.some(([key]) => key !== 'email' && key !== 'password')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Only email and password are accepted.');
  }
  const emailValue: unknown = Reflect.get(body, 'email');
  const password: unknown = Reflect.get(body, 'password');
  const email = typeof emailValue === 'string' ? normalizeEmail(emailValue) : '';
  const details: Record<string, string> = {};
  if (!isValidEmail(email)) details.email = 'Enter a valid email address of at most 254 characters.';
  if (typeof password !== 'string' || Array.from(password).length < 8 || Buffer.byteLength(password, 'utf8') > 72) {
    details.password = 'Use at least 8 characters and at most 72 UTF-8 bytes.';
  }
  if (Object.keys(details).length > 0 || typeof password !== 'string') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Please check the request.', details);
  }
  return { email, password };
}
