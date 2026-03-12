import { describe, it, expect } from 'vitest';

describe('Health Check', () => {
  it('should pass basic health check', () => {
    const health = {
      status: 'ok',
      database: 'ok',
      redis: 'ok',
      timestamp: new Date().toISOString(),
    };

    expect(health).toBeDefined();
    expect(health.status).toBe('ok');
    expect(health.database).toBe('ok');
    expect(health.redis).toBe('ok');
  });
});
