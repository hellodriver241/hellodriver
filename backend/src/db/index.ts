import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

let pool: Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

export function initializeDatabase() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL environment variable is not set');
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  // Cache Drizzle instance with the pool
  db = drizzle(pool, { schema });

  return pool;
}

export function getDatabase() {
  if (!db) {
    initializeDatabase();
  }
  return db!;
}

export function closeDatabase() {
  if (pool) {
    pool.end();
    pool = null;
    db = null;
  }
}

export type Database = ReturnType<typeof getDatabase>;
