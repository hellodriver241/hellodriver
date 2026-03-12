import Fastify, { FastifyInstance } from 'fastify';
import jwtPlugin from '@fastify/jwt';
import multipartPlugin from '@fastify/multipart';
import { config } from './config.js';
import { errorHandler } from '../shared/errors/handlers.js';

/**
 * Create and configure Fastify app
 */
export async function createApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.DEBUG ? 'debug' : 'info',
    },
  });

  // Register JWT plugin
  app.register(jwtPlugin, {
    secret: config.JWT_SECRET,
  });

  // Register multipart (for file uploads)
  app.register(multipartPlugin, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB max
    },
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Graceful shutdown
  app.addHook('onClose', async () => {
    app.log.info('Server shutting down gracefully');
  });

  return app;
}
