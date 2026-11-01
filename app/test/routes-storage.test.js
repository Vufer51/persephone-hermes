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

describe('storage roots routes', () => {
  describe('POST /api/v1/storage-roots', () => {
    it('должен возвращать 400 для невалидного name', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage-roots',
        payload: { name: '', type: 'local', identifier: '/mnt/music' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать 400 для невалидного type', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage-roots',
        payload: { name: 'music', type: 'invalid', identifier: '/mnt/music' },
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать 409 при дубликате имени', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('WHERE name =')) {
          return { rows: [{ id: 'existing-id', name: 'music', type: 'local', identifier: '/mnt/music', status: 'active' }] };
        }
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage-roots',
        payload: { name: 'music', type: 'local', identifier: '/mnt/music' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe('name_already_exists');
    });

    it('должен создавать хранилище и возвращать 201', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('WHERE name =')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO storage_roots')) {
          return { rows: [{ id: 'new-id', name: 'music', type: 'local', identifier: '/mnt/music', status: 'active', createdAt: new Date().toISOString() }] };
        }
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/storage-roots',
        payload: { name: 'music', type: 'local', identifier: '/mnt/music' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.name).toBe('music');
      expect(body.type).toBe('local');
      expect(body.identifier).toBe('/mnt/music');
      expect(body.status).toBe('active');
      expect(body.id).toBeDefined();
    });
  });

  describe('GET /api/v1/storage-roots', () => {
    it('должен возвращать список хранилищ', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [
          { id: 'id-1', name: 'alpha', type: 'local', identifier: '/mnt/a', status: 'active', createdAt: new Date().toISOString() },
          { id: 'id-2', name: 'beta', type: 'nfs', identifier: 'nfs://server/music', status: 'maintenance', createdAt: new Date().toISOString() },
        ],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage-roots',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.storageRoots).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('должен фильтровать по статусу', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [
          { id: 'id-2', name: 'beta', type: 'nfs', identifier: 'nfs://server/music', status: 'maintenance', createdAt: new Date().toISOString() },
        ],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage-roots?status=maintenance',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().storageRoots).toHaveLength(1);
      expect(response.json().storageRoots[0].status).toBe('maintenance');
    });
  });

  describe('GET /api/v1/storage-roots/:id', () => {
    it('должен возвращать 404 при отсутствии', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage-roots/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('not_found');
    });

    it('должен возвращать хранилище', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'active', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/storage-roots/id-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('music');
    });
  });

  describe('PATCH /api/v1/storage-roots/:id', () => {
    it('должен возвращать 404 при отсутствии', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/storage-roots/nonexistent-id',
        payload: { status: 'maintenance' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('должен возвращать 409 при отключённом хранилище', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'disabled' }],
      }));

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/storage-roots/id-1',
        payload: { status: 'active' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('должен обновлять статус', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (sql.includes('SELECT')) {
          return { rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'active' }] };
        }
        return { rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'maintenance' }] };
      });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/storage-roots/id-1',
        payload: { status: 'maintenance' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().status).toBe('maintenance');
    });
  });

  describe('DELETE /api/v1/storage-roots/:id', () => {
    it('должен возвращать 404 при отсутствии', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/storage-roots/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
    });

    it('должен возвращать 409 при неактивном хранилище', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({
        rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'maintenance' }],
      }));

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/storage-roots/id-1',
      });

      expect(response.statusCode).toBe(409);
    });

    it('должен отключать хранилище и возвращать 200', async () => {
      const app = createApp();
      let callCount = 0;
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        callCount++;
        if (sql.includes('SELECT')) {
          return { rows: [{ id: 'id-1', name: 'music', type: 'local', identifier: '/mnt/music', status: 'active' }] };
        }
        if (callCount === 2) {
          // первый вызов UPDATE — success
          return { rows: [{ id: 'id-1' }] };
        }
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/storage-roots/id-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().message).toContain('отключено');
    });
  });
});
