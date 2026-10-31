import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    restoreMocks: true,
  },
});
