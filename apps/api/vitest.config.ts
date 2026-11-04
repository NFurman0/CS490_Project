import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @reviewlens/shared to its TypeScript source during tests.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
