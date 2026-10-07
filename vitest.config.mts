import { defineConfig } from 'vitest/config';

/** Workspace-local tests only; generated JavaScript in dist/source trees is not executable test input. */
export default defineConfig({
  root: process.cwd(),
  test: {
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
