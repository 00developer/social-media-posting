import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests (lib helpers) and server-side render tests (components via react-dom/server).
// The "@" alias matches tsconfig paths so components can be imported the way the app does.
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
