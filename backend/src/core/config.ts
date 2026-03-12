/**
 * Environment configuration - validated on startup
 */

const requiredEnvVars = [
  'DATABASE_URL',
  'REDIS_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NODE_ENV',
];

requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
});

// JWT_SECRET can be either JWT_SECRET or SUPABASE_JWT_SECRET
const jwtSecret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
if (!jwtSecret) {
  throw new Error('Missing required environment variable: JWT_SECRET or SUPABASE_JWT_SECRET');
}

export const config = {
  // Server
  NODE_ENV: process.env.NODE_ENV as 'development' | 'production' | 'test',
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',

  // Database
  DATABASE_URL: process.env.DATABASE_URL!,
  REDIS_URL: process.env.REDIS_URL!,

  // Auth
  JWT_SECRET: jwtSecret,
  JWT_EXPIRES_IN: '7d',

  // Supabase
  SUPABASE_URL: process.env.SUPABASE_URL!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  SUPABASE_STORAGE_BUCKET: 'driver-documents',

  // SMS (D7 Networks or mock)
  D7_NETWORKS_API_KEY: process.env.D7_NETWORKS_API_KEY,
  SMS_PROVIDER: (process.env.SMS_PROVIDER as 'd7' | 'mock') || 'mock',

  // Feature flags
  DEBUG: process.env.DEBUG === 'true',
} as const;

export type Config = typeof config;
