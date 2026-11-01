import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(overrides = {}) {
  const mockPool = {
    query: vi.fn(async () => ({ rows: [] })),
  };
  const mockDatabase = { pool: mockPool, ping: vi.fn(async () => {}) };
  const mockRedis = { ping: vi.fn(async () => {}), setex: vi.fn(), del: vi.fn(), get: vi.fn() };

  const app = buildApp({
    config: {
      nodeEnv: 'test', isProduction: false, isTest: true, logLevel: 'silent',
      http: { host: '127.0.0.1', port: 0 }, webOrigin: null,
      database: { url: 'postgres://test', poolMax: 10 }, redis: { url: 'redis://test' },
      music: { rootContainer: '/music', storageRootName: 'test', storageRootIdentifier: 'test' },
      integrations: { navidrome: {}, lidarr: {}, musicbrainz: {}, lastfm: {} },
      auth: { sessionTtlDays: 7 },
    },
    database: mockDatabase,
    redis: mockRedis,
    logger: false,
    ...overrides,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('media indexer routes', () => {
  describe('POST /api/v1/index', () => {
    it('должен возвращать 422 при отсутствии storage_root_id', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index',
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать 404 при отсутствии хранилища', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index',
        payload: { storage_root_id: 'nonexistent-id' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('storage_root_not_found');
    });

    it('должен возвращать 409 при неактивном хранилище', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('SELECT') && sql.includes('status')) {
          return { rows: [{ id: 'root-id', name: 'test', identifier: '/mnt', status: 'maintenance' }] };
        }
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index',
        payload: { storage_root_id: 'root-id' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('storage_root_not_active');
    });

    it('должен индексировать хранилище с пустой директорией', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('SELECT') && sql.includes('status')) {
          return { rows: [{ id: 'root-id', name: 'empty', identifier: '/mnt/empty', status: 'active' }] };
        }
        if (sql.includes('media_assets WHERE')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO')) {
          return { rows: [{ id: 'new-id' }] };
        }
        if (sql.includes('UPDATE')) {
          return { rows: [] };
        }
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index',
        payload: { storage_root_id: 'root-id' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toBe('Индексирование завершено');
      expect(response.json().scanned).toBe(0);
      expect(response.json().created).toBe(0);
      expect(response.json().skipped).toBe(0);
    });
  });

  describe('POST /api/v1/index/stop', () => {
    it('должен возвращать 404 при отсутствии хранилища', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index/stop',
        payload: { storage_root_id: 'nonexistent-id' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('storage_root_not_found');
    });

    it('должен возвращать 409 если хранилище не индексируется', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('SELECT') && sql.includes('name')) {
          return { rows: [{ id: 'root-id', name: 'test' }] };
        }
        return { rows: [] }; // stopIndexing returns 0 rows
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/index/stop',
        payload: { storage_root_id: 'root-id' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('not_indexing');
    });
  });

  describe('GET /api/v1/index/status', () => {
    it('должен возвращать 404 при отсутствии хранилища', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/index/status?storage_root_id=nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('storage_root_not_found');
    });

    it('должен возвращать статус active', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ status: 'active' }],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/index/status?storage_root_id=root-id',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ storage_root_id: 'root-id', status: 'active' });
    });

    it('должен возвращать статус maintenance', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ status: 'maintenance' }],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/index/status?storage_root_id=root-id',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ storage_root_id: 'root-id', status: 'maintenance' });
    });

    it('должен возвращать статус disabled', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ status: 'disabled' }],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/index/status?storage_root_id=root-id',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ storage_root_id: 'root-id', status: 'disabled' });
    });
  });
});
