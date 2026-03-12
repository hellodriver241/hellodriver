import { initializeDatabase } from './db/index.js';
import { createApp } from './core/app.js';
import { registerRoutes } from './routes.js';

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
    const port = process.env.PORT || '3000';
    const host = process.env.HOST || '0.0.0.0';

    await app.listen({ port: parseInt(port as string, 10), host });
    console.log(`✓ Server running at http://${host}:${port}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`✗ Failed to start server: ${errorMessage}`);
    process.exit(1);
  }
};

start();
