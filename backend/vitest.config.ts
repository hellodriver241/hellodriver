import { defineConfig } from 'vitest/config';
import dotenv from 'dotenv';
import dns from 'dns';
import path from 'path';

// Pin NODE_ENV=test before any .env file can override it
process.env.NODE_ENV = 'test';

// Load .env.local (real credentials) first, then .env.test fills in anything missing.
// override: false means already-set vars (including NODE_ENV=test above) are never touched.
dotenv.config({ path: path.resolve(__dirname, '.env.local'), override: false });
dotenv.config({ path: path.resolve(__dirname, '.env.test'), override: false });

// The system DNS resolver refuses connections from Node.js on this machine (ECONNREFUSED).
// Force-use Google DNS (8.8.8.8) so hostname resolution works for Supabase pooler.
dns.setServers(['8.8.8.8', '1.1.1.1']);

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
      ],
    },
  },
});
