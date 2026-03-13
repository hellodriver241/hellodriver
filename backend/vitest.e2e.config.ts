import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import path from 'path';

process.env.NODE_ENV = 'test';

dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: false });
dotenv.config({ path: path.resolve(__dirname, '.env.test'), override: false });

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/e2e.gabon.test.ts'],
    testTimeout: 30000,
    hookTimeout: 180000,
  },
});
