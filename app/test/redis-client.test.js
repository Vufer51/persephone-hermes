import { describe, expect, it, vi } from 'vitest';

vi.mock('ioredis', () => ({
  Redis: class {
    constructor(url, options) {
      this.url = url;
      this.options = options;
    }

    on() {}
  },
}));

const { createRedisClient } = await import('../src/services/redis.js');

describe('createRedisClient', () => {
  it('не задаёт commandTimeout, если он отключён', () => {
    const client = createRedisClient('redis://localhost:6379', { commandTimeout: null });

    expect(client.options).not.toHaveProperty('commandTimeout');
  });

  it('не передаёт нулевой commandTimeout в ioredis', () => {
    const client = createRedisClient('redis://localhost:6379', { commandTimeout: 0 });

    expect(client.options).not.toHaveProperty('commandTimeout');
  });

  it('передаёт положительный commandTimeout', () => {
    const client = createRedisClient('redis://localhost:6379', { commandTimeout: 3000 });

    expect(client.options.commandTimeout).toBe(3000);
  });

  it('по умолчанию использует commandTimeout 3000 мс', () => {
    const client = createRedisClient('redis://localhost:6379');

    expect(client.options.commandTimeout).toBe(3000);
  });

  it('передаёт maxRetriesPerRequest без изменений', () => {
    const client = createRedisClient('redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });

    expect(client.options.maxRetriesPerRequest).toBeNull();
  });
});
