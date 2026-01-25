import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'src/**/*.ts'
      ],
      exclude: [
        'node_modules/',
        'dist/',
        'src/__tests__/**',
        '**/*.d.ts',
        'src/reflexive.js',
        'src/inject.cjs',
        'src/index.ts',  // Re-exports, not much logic
        'src/types/**',  // Type definitions only
        'src/cli.ts',    // Entry point with HTTP server - integration tested
        'src/mcp/local-tools.ts',  // Future phase
        'src/core/chat-stream.ts'  // Uses claude-agent-sdk - integration tested
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70
      }
    },
    setupFiles: ['./src/__tests__/setup.ts'],
    testTimeout: 30000
  }
});
