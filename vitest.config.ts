import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Most tests are pure logic and run in node. DOM-dependent suites opt in
    // with an `@vitest-environment happy-dom` docblock.
    environment: 'node',
  },
});
