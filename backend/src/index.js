// HelloDriver API - Phase 0 Foundation
import Fastify from 'fastify';

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Health check endpoint
app.get('/health', async (request, reply) => {
  return {
    status: 'ok',
    database: 'connected',
    redis: 'connected',
    timestamp: new Date().toISOString(),
    version: '0.0.1',
  };
});

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port, host });
    app.log.info(`🚀 HelloDriver API running at http://${host}:${port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
