import Redis from 'ioredis';
import { config } from '../core/config.js';

let redisClient: Redis | null = null;

/**
 * Initialize Redis client
 * Connects to Railway Redis TCP endpoint via REDIS_URL
 */
export async function initializeRedis(): Promise<Redis> {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(config.REDIS_URL);

  redisClient.on('error', (err: Error) => console.error('Redis Client Error', err));

  await redisClient.ping();
  console.log('✓ Redis connected');

  return redisClient;
}

/**
 * Get Redis client
 * Must call initializeRedis() first
 */
export function getRedis(): Redis {
  if (!redisClient) {
    throw new Error('Redis not initialized. Call initializeRedis() first.');
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}
