import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
export default defineConfig([...nextVitals, ...nextTs,
  // This standalone diagnostic intentionally runs as CommonJS with a caller-selected compiler.
  { files: ['scripts/check-syntax.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  globalIgnores(['.next/**', '.local/**', '.cache/**', 'next-env.d.ts', 'playwright-report/**'])
]);
