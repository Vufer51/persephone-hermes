import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { generateToken } from '../src/modules/auth/crypto.js';

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
      http: { host: '127.0.0.1', port: 0 }, webOrigin: 'http://localhost:5173',
      database: { url: 'postgres://test', poolMax: 10 }, redis: { url: 'redis://test' },
      music: { rootContainer: '/music', storageRootName: 'test', storageRootIdentifier: 'test' },
      integrations: {
        navidrome: { url: 'http://navidrome:4533', user: 'admin', password: 'password' },
        lidarr: {}, musicbrainz: {}, lastfm: { apiKey: 'test_key', sharedSecret: 'test_secret', baseUrl: 'https://ws.audioscrobbler.com/2.0/' },
      },
      auth: { sessionTtlDays: 7 },
      secrets: {
        encryptionKey: Buffer.from('a'.repeat(32)).toString('base64'),
        encryptionKeyVersion: 1,
      },
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

function makeAuth(token) {
  return { authorization: `Bearer ${token}` };
}

describe('Last.fm integration routes', () => {
  let validToken;

  beforeEach(() => {
    validToken = generateToken();
  });

  describe('GET /api/v1/integrations/lastfm/auth-url', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/lastfm/auth-url',
      });
      expect(response.statusCode).toBe(401);
    });

    it('должен возвращать auth URL', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/lastfm/auth-url',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().authUrl).toContain('api/auth/');
      expect(response.json().authUrl).toContain('api_key=test_key');
    });
  });

  describe('GET /api/v1/integrations/lastfm/status', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/lastfm/status',
      });
      expect(response.statusCode).toBe(401);
    });

    it('должен возвращать disconnected если нет подключения', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query.mockResolvedValue({ rows: [] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/integrations/lastfm/status',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().connected).toBe(false);
      expect(response.json().status).toBe('disconnected');
    });
  });

  describe('POST /api/v1/integrations/lastfm/callback', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/callback',
        payload: { token: 'test_token' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('должен возвращать 400 без токена', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/callback',
        headers: makeAuth(validToken),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('DELETE /api/v1/integrations/lastfm', () => {
    it('должен отключать Last.fm', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query.mockResolvedValue({ rowCount: 1 });

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/integrations/lastfm',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().disconnected).toBe(true);
    });
  });
});