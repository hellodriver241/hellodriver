import { FastifyInstance } from 'fastify';
import { registerAuthRoutes } from './domains/auth/auth.routes.js';
import { registerDriverRoutes } from './domains/driver/driver.routes.js';

/**
 * Register all routes
 * This is the central place where all domain routes are registered
 */
export async function registerRoutes(app: FastifyInstance) {
  // Health check endpoint (no auth required)
  app.get('/health', async () => {
    return { status: 'ok' };
  });

  // Auth routes
  await registerAuthRoutes(app);

  // Driver routes
  await registerDriverRoutes(app);

  // TODO: Phase 3 - Trip routes
  // TODO: Phase 3 - Payment routes
  // TODO: Phase 3 - Admin routes (beyond driver verification)
}
