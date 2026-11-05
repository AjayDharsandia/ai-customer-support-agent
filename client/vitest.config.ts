import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], env: { VITE_API_BASE_URL: 'http://localhost:5000' } },
});
