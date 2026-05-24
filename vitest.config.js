// Separate from vite.config.js because the demo Vite config rebases `root` to
// `demo/`, which would make Vitest miss `src/**/*.test.ts`.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
});
