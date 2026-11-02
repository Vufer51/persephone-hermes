import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(overrides = {}) {
  const mockPoolQuery = vi.fn(async (sql) => {
    if (sql.includes('user_sessions')) {
      return {
        rows: [{
          session_id: 's1',
          user_id: 'u1',
          email: 'test@test.com',
          username: 'test',
          role: 'user',
          user_status: 'active',
          expires_at: new Date(Date.now() + 86400000).toISOString(),
        }],
      };
    }
    if (sql.includes('media_assets')) {
      return { rows: [{ id: 'a1', relative_path: '/music/track.mp3', format: 'mp3', title: 'Test Track', artist_name: 'Test Artist' }] };
    }
    if (sql.includes('COUNT(*)')) {
      return { rows: [{ total: '0' }] };
    }
    return { rows: [] };
  });

  const mockPool = { query: mockPoolQuery };
  const mockDatabase = { pool: mockPool, ping: vi.fn(async () => {}) };
  const mockRedis = {
    ping: vi.fn(async () => {}),
    setex: vi.fn(),
    del: vi.fn(),
    get: vi.fn(async () => null),
  };

  const app = buildApp({
    config: {
      nodeEnv: 'test',
      isProduction: false,
      isTest: true,
      logLevel: 'silent',
      http: { host: '127.0.0.1', port: 0 },
      webOrigin: null,
      database: { url: 'postgres://test', poolMax: 10 },
      redis: { url: 'redis://test' },
      music: { rootContainer: '/music', storageRootName: 'test', storageRootIdentifier: 'test' },
      integrations: {
        navidrome: { url: 'http://navidrome:4533', user: 'admin', password: 'password' },
        lidarr: {},
        musicbrainz: {},
        lastfm: {},
      },
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
  vi.restoreAllMocks();
});

describe('Web Player routes', () => {
  describe('GET /api/v1/player/stream/:mediaAssetId', () => {
    it('должен возвращать streamUrl для существующего медиа-ассета', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/player/stream/11111111-1111-1111-1111-111111111111',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.streamUrl).toBeDefined();
    });

    it('должен возвращать 404 если медиа-ассет не найден', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async (sql) => {
              if (sql.includes('user_sessions')) {
                return {
                  rows: [{
                    session_id: 's1', user_id: 'u1', email: 't@t.com', username: 'test',
                    role: 'user', user_status: 'active',
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                  }],
                };
              }
              return { rows: [] };
            }),
          },
          ping: vi.fn(async () => {}),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/player/stream/11111111-1111-1111-1111-111111111111',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/player/now-playing', () => {
    it('должен возвращать 404 если нет активного воспроизведения', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async (sql) => {
              if (sql.includes('user_sessions')) {
                return {
                  rows: [{
                    session_id: 's1', user_id: 'u1', email: 't@t.com', username: 'test',
                    role: 'user', user_status: 'active',
                    expires_at: new Date(Date.now() + 86400000).toISOString(),
                  }],
                };
              }
              return { rows: [] };
            }),
          },
          ping: vi.fn(async () => {}),
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/player/now-playing',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /api/v1/player/history', () => {
    it('должен возвращать историю воспроизведения', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/player/history',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tracks).toBeDefined();
      expect(body.total).toBeDefined();
    });
  });

  describe('GET /api/v1/player/assets', () => {
    it('должен возвращать список доступных медиа-ассетов', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/player/assets',
        headers: { authorization: 'Bearer test-token' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.assets).toBeDefined();
      expect(body.total).toBeDefined();
    });
  });
});
