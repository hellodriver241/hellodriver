import { initializeDatabase } from './db/index.js';
import { createApp } from './core/app.js';
import { registerRoutes } from './routes.js';
import { config } from './core/config.js';

const start = async () => {
  try {
    // Initialize database
    initializeDatabase();
    console.log('✓ Database initialized');

    // Create app
    const app = await createApp();

    // Register routes
    await registerRoutes(app);
    console.log('✓ Routes registered');

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
