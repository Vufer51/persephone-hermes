import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(overrides = {}) {
  const app = buildApp({
    config: {},
    database: { ping: vi.fn(async () => {}) },
    redis: { ping: vi.fn(async () => {}) },
    logger: false,
    ...overrides,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('health routes', () => {
  it('GET /api/v1/health/live отвечает без зависимостей', async () => {
    const database = { ping: vi.fn(async () => {}) };
    const redis = { ping: vi.fn(async () => {}) };
    const app = createApp({ database, redis });

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok' });
    expect(database.ping).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
  });

  it('GET /api/v1/health/ready возвращает 200 при доступных зависимостях', async () => {
    const app = createApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ready',
      checks: { postgres: 'ok', redis: 'ok' },
    });
  });

  it('GET /api/v1/health/ready возвращает 503, если PostgreSQL недоступен', async () => {
    const app = createApp({
      database: {
        ping: vi.fn(async () => {
          throw new Error('connection refused');
        }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      checks: { postgres: 'error', redis: 'ok' },
    });
    expect(response.body).not.toContain('connection refused');
  });

  it('GET /api/v1/health/ready возвращает 503, если Redis недоступен', async () => {
    const app = createApp({
      redis: {
        ping: vi.fn(async () => {
          throw new Error('redis down');
        }),
      },
    });

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'unavailable',
      checks: { postgres: 'ok', redis: 'error' },
    });
  });
});

describe('error handling', () => {
  it('возвращает единый формат для неизвестного маршрута', async () => {
    const app = createApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/unknown' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: { code: 'not_found' },
    });
    expect(response.json().error.requestId).toBeTypeOf('string');
  });

  it('не раскрывает внутренние детали ошибки 500', async () => {
    const app = createApp();
    app.get('/boom', async () => {
      throw new Error('database password is secret');
    });

    const response = await app.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      error: { code: 'internal_error', message: 'Внутренняя ошибка сервера' },
    });
    expect(response.body).not.toContain('password');
  });

  it('принимает корректный x-request-id и возвращает его в ответе', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-request-id': 'request-123' },
    });

    expect(response.headers['x-request-id']).toBe('request-123');
  });

  it('заменяет небезопасный x-request-id на сгенерированный', async () => {
    const app = createApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health/live',
      headers: { 'x-request-id': 'bad id with spaces' },
    });

    expect(response.headers['x-request-id']).not.toBe('bad id with spaces');
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('добавляет заголовок x-content-type-options', async () => {
    const app = createApp();

    const response = await app.inject({ method: 'GET', url: '/api/v1/health/live' });

    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
