import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { generateToken } from '../src/modules/auth/crypto.js';

// Mock Last.fm client to avoid real HTTP calls
const mockLastFmClient = {
  getSession: vi.fn(async () => 'mock_session_key'),
  updateNowPlaying: vi.fn(async () => ({ success: true })),
  getLovedTracks: vi.fn(async () => ({ lovedtracks: { track: [], '@attr': { totalPages: '1' } } })),
  getTopArtists: vi.fn(async () => ({ topartists: { artist: [], '@attr': { totalPages: '1' } } })),
  getRecentTracks: vi.fn(async () => ({ recenttracks: { track: [], '@attr': { totalPages: '1' } } })),
};

// Mock the lastfm-client module
vi.mock('../src/integrations/lastfm-client.js', () => ({
  createLastFmClient: vi.fn(() => mockLastFmClient),
}));

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(_overrides = {}) {
  const mockPool = {
    query: vi.fn(async (sql) => {
      if (sql.includes('user_sessions')) {
        return {
          rows: [{
            session_id: 's1',
            user_id: 'u1',
            email: 'test@test.com',
            username: 'testuser',
            role: 'user',
            user_status: 'active',
            expires_at: new Date(Date.now() + 86400000).toISOString(),
          }],
        };
      }
      if (sql.includes('user_lastfm')) {
        return {
          rows: [{
            session_key_encrypted: 'AeSmqyIE7A4vZGAIYUl/FGVPYCrvW74NoR/5im4dzhprMA+avf8KACAQsT7l',
            encryption_key_version: 1,
          }],
        };
      }
      return { rows: [] };
    }),
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
        lastfm: { apiKey: 'test_key', sharedSecret: 'test_secret', baseUrl: 'https://ws.audioscrobbler.com/2.0/' },
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
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  Object.values(mockLastFmClient).forEach((fn) => fn.mockReset());
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

  describe('POST /api/v1/integrations/lastfm/now-playing', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/now-playing',
        payload: { artist: 'Test Artist', track: 'Test Track' },
      });
      expect(response.statusCode).toBe(401);
    });

    it('должен возвращать 400 без обязательных полей', async () => {
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
        url: '/api/v1/integrations/lastfm/now-playing',
        headers: makeAuth(validToken),
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('должен обновлять Now Playing в Last.fm', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/now-playing',
        headers: makeAuth(validToken),
        payload: { artist: 'Test Artist', track: 'Test Track', album: 'Test Album', duration: 180 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mockLastFmClient.updateNowPlaying).toHaveBeenCalledWith(
        { artist: 'Test Artist', track: 'Test Track', album: 'Test Album', duration: 180 },
        'mock_session_key',
      );
    });
  });

  describe('POST /api/v1/integrations/lastfm/sync', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/sync',
      });
      expect(response.statusCode).toBe(401);
    });

    it('должен запускать синхронизацию и возвращать результаты', async () => {
      const app = createApp();

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/integrations/lastfm/sync',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(response.json().results).toBeDefined();
      expect(response.json().results.lovedTracks).toBe(0);
      expect(response.json().results.topArtists).toBe(0);
      expect(response.json().results.recentTracks).toBe(0);
      expect(mockLastFmClient.getLovedTracks).toHaveBeenCalled();
      expect(mockLastFmClient.getTopArtists).toHaveBeenCalled();
      expect(mockLastFmClient.getRecentTracks).toHaveBeenCalled();
    });
  });
});
