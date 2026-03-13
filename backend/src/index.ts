import { initializeDatabase } from './db/index.js';
import { initializeRedis } from './plugins/redis.js';
import { initializeSocketIO } from './plugins/socketio.js';
import { createApp } from './core/app.js';
import { registerRoutes } from './routes.js';
import { config } from './core/config.js';

const start = async () => {
  try {
    // Initialize database
    initializeDatabase();
    console.log('✓ Database initialized');

    // Initialize Redis
    await initializeRedis();

    // Create app
    const app = await createApp();

    // Register routes
    await registerRoutes(app);
    console.log('✓ Routes registered');

    // Initialize Socket.io
    initializeSocketIO(app.server);

    // Start server
    await app.listen({ port: config.PORT, host: config.HOST });
    console.log(`✓ Server running at http://${config.HOST}:${config.PORT}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to start server: ${errorMessage}`);
    process.exit(1);
  }
};

start();
