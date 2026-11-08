import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Resolve @reviewlens/shared to its TypeScript source during tests.
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Database tests share one test database and reset it between tests, so test
    // files run one at a time to keep them from deleting each other's rows.
    fileParallelism: false,
  },
});
