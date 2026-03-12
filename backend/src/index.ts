import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { config } from 'dotenv';
import { initializeDatabase } from './db/index.js';
import { authRoutes } from './routes/auth.js';
import { driverRoutes } from './routes/driver.js';

// Load environment variables
config();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Initialize database
try {
  initializeDatabase();
  app.log.info('Database initialized');
} catch (err) {
  const errorMessage = err instanceof Error ? err.message : String(err);
  app.log.error(`Failed to initialize database: ${errorMessage}`);
  process.exit(1);
}

// Register plugins
await app.register(cors, {
  origin: true,
  credentials: true,
});

await app.register(multipart);

// Type declaration for authenticate hook
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

// Only register JWT if secret is provided
if (process.env.SUPABASE_JWT_SECRET) {
  await app.register(jwt, {
    secret: process.env.SUPABASE_JWT_SECRET,
  });

  // Decorate app with authenticate hook
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });
} else {
  // Mock authentication for development without JWT secret
  app.decorate('authenticate', async function (request: FastifyRequest, reply: FastifyReply) {
    // In development, allow requests without auth
    // In production, this should fail
    if (process.env.NODE_ENV === 'production') {
      reply.code(500).send({ error: 'JWT_SECRET not configured' });
    }
  });
}

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

// Register routes
await app.register(authRoutes);
await app.register(driverRoutes);

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`Server running at http://${host}:${port}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    app.log.error(`Server failed to start: ${errorMessage}`);
    process.exit(1);
  }
};

start();
