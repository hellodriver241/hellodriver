import type { Config } from 'drizzle-kit';

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is required for drizzle-kit');
}

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'],
  },
  // Note: PostGIS extensions and custom functions are not handled by Drizzle
  // Apply those separately via SQL migrations if needed
  verbose: true,
  strict: true,
} satisfies Config;
