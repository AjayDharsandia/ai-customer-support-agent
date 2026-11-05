import type { AuthRequest } from '../types/api';

export function validateAuthForm(input: AuthRequest): Partial<Record<keyof AuthRequest, string>> {
  const errors: Partial<Record<keyof AuthRequest, string>> = {};
  const email = input.email.trim().toLowerCase();
  if (Array.from(email).length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    errors.email = 'Enter a valid email address.';
  }
  if (Array.from(input.password).length < 8 || new TextEncoder().encode(input.password).length > 72) {
    errors.password = 'Use at least 8 characters and at most 72 UTF-8 bytes.';
  }
  return errors;
}
