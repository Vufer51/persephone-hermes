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
      http: { host: '127.0.0.1', port: 0 }, webOrigin: null,
      database: { url: 'postgres://test', poolMax: 10 }, redis: { url: 'redis://test' },
      music: { rootContainer: '/music', storageRootName: 'test', storageRootIdentifier: 'test' },
      integrations: {
        navidrome: { url: 'http://navidrome:4533', user: 'admin', password: 'password' },
        lidarr: {}, musicbrainz: {}, lastfm: {},
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
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

function makeAuth(token) {
  return { authorization: `Bearer ${token}` };
}

describe('playback routes', () => {
  let validToken;

  beforeEach(() => {
    validToken = generateToken();
  });

  describe('POST /api/v1/playback/sessions', () => {
    it('должен возвращать 401 без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playback/sessions',
        payload: { recordingId: '11111111-1111-1111-1111-111111111111', mediaAssetId: '22222222-2222-2222-2222-222222222222' },
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
        url: '/api/v1/playback/sessions',
        headers: makeAuth(validToken),
        payload: {},
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен создавать сессию воспроизведения', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444' }] });
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{
          id: '44444444-4444-4444-4444-444444444444',
          user_id: '55555555-5555-5555-5555-555555555555',
          recording_id: '11111111-1111-1111-1111-111111111111',
          media_asset_id: '22222222-2222-2222-2222-222222222222',
          started_at: '2024-01-01T00:00:00Z',
          start_position_ms: 0,
          source: 'api',
        }] });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/playback/sessions',
        headers: makeAuth(validToken),
        payload: { recordingId: '11111111-1111-1111-1111-111111111111', mediaAssetId: '22222222-2222-2222-2222-222222222222', startPositionMs: 0 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session).toBeDefined();
      expect(response.json().session.recording_id).toBe('11111111-1111-1111-1111-111111111111');
    });
  });

  describe('PATCH /api/v1/playback/sessions/:id', () => {
    it('должен возвращать 404 для чужой сессии', async () => {
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
        method: 'PATCH',
        url: '/api/v1/playback/sessions/44444444-4444-4444-4444-444444444444',
        headers: makeAuth(validToken),
        payload: { positionMs: 5000 },
      });

      expect(response.statusCode).toBe(404);
    });

    it('должен обновлять позицию воспроизведения', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', user_id: '55555555-5555-5555-5555-555555555555', ended_at: null }] });
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', end_position_ms: 10000, listened_ms: 10000 }] });

      const response = await app.inject({
        method: 'PATCH',
        url: '/api/v1/playback/sessions/44444444-4444-4444-4444-444444444444',
        headers: makeAuth(validToken),
        payload: { positionMs: 10000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session.end_position_ms).toBe(10000);
    });
  });

  describe('DELETE /api/v1/playback/sessions/:id', () => {
    it('должен завершать сессию и ставить скроббл если достаточно прослушано', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '11111111-1111-1111-1111-111111111111', duration_ms: 200000, start_position_ms: 0 }] }); // ownership check
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '11111111-1111-1111-1111-111111111111', duration_ms: 200000, start_position_ms: 0 }] }); // endSession SELECT
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [] }); // UPDATE
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [] }); // INSERT scrobble

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/playback/sessions/44444444-4444-4444-4444-444444444444?endPositionMs=150000',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session.completed).toBe(true);
    });

    it('не должен ставить скроббл если прослушано мало', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '11111111-1111-1111-1111-111111111111', duration_ms: 200000, start_position_ms: 0 }] }); // ownership check
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ id: '44444444-4444-4444-4444-444444444444', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '11111111-1111-1111-1111-111111111111', duration_ms: 200000, start_position_ms: 0 }] }); // endSession SELECT
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [] }); // UPDATE

      const response = await app.inject({
        method: 'DELETE',
        url: '/api/v1/playback/sessions/44444444-4444-4444-4444-444444444444?endPositionMs=10000',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session.completed).toBe(false);
    });
  });

  describe('GET /api/v1/playback/history', () => {
    it('должен возвращать историю воспроизведения', async () => {
      const app = createApp();
      app.dependencies.redis.get.mockResolvedValue(JSON.stringify({
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test@test.com',
        username: 'testuser',
        role: 'user',
        sessionId: '33333333-3333-3333-3333-333333333333',
      }));
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [{ total: '2' }] });
      app.dependencies.database.pool.query
        .mockResolvedValueOnce({ rows: [
          { id: 's1', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '11111111-1111-1111-1111-111111111111', started_at: '2024-01-01', ended_at: '2024-01-01', recording_title: 'Song A', artist_name: 'Artist A' },
          { id: 's2', user_id: '55555555-5555-5555-5555-555555555555', recording_id: '22222222-2222-2222-2222-222222222222', started_at: '2024-01-02', ended_at: '2024-01-02', recording_title: 'Song B', artist_name: 'Artist B' },
        ] });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/playback/history?limit=10&offset=0',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().sessions).toHaveLength(2);
      expect(response.json().total).toBe(2);
    });
  });

  describe('GET /api/v1/playback/sessions/active', () => {
    it('должен возвращать активную сессию или null', async () => {
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
        url: '/api/v1/playback/sessions/active',
        headers: makeAuth(validToken),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().session).toBeNull();
    });
  });
});