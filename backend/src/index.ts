import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { config } from 'dotenv';

// Load environment variables
config();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register plugins
await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(jwt, {
  secret: process.env.SUPABASE_JWT_SECRET || '',
});

// Health check endpoint
app.get('/health', async (request, reply) => {
  try {
    // TODO: Check database connection
    // TODO: Check Redis connection

    return {
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    reply.code(500);
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
