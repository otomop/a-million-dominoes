import { defineConfig } from 'vitest/config';

// `base: './'` keeps every asset URL relative, so the build works unchanged
// when GitHub Pages serves it from a sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
