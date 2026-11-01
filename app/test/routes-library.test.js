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

/** @param {string} sql */
function includesSql(sql, ...patterns) {
  return patterns.some((p) => sql.toLowerCase().includes(p.toLowerCase()));
}

describe('library search routes', () => {
  describe('GET /api/v1/library/search', () => {
    it('должен возвращать 400 при отсутствии поискового запроса', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/search',
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать 400 для пустого запроса', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/search?q=',
      });
      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать пустые результаты когда ничего не найдено', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '0' }] };}
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/search?q=nonexistent',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.query).toBe('nonexistent');
      expect(body.artists).toEqual([]);
      expect(body.recordings).toEqual([]);
      expect(body.releases).toEqual([]);
      expect(body.media_assets).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('должен возвращать результаты поиска по артисту', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'artists WHERE')) { return { rows: [{ id: 'a1', name: 'Test Artist' }] }; }
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '2' }] };}
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/search?q=Test+Artist',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().artists).toEqual([{ id: 'a1', name: 'Test Artist' }]);
    });

    it('должен поддерживать пагинацию', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '0' }] };}
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/search?q=test&limit=10&offset=5',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().limit).toBe(10);
      expect(response.json().offset).toBe(5);
    });
  });

  describe('GET /api/v1/library/artists', () => {
    it('должен возвращать список артистов с пагинацией', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '5' }] };}
        const rows = [
          { id: 'a1', name: 'Artist A', sort_name: null, created_at: '2024-01-01' },
          { id: 'a2', name: 'Artist B', sort_name: null, created_at: '2024-01-02' },
        ];
        return { rows };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/artists?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.total).toBe(5);
      expect(body.artists).toHaveLength(2);
      expect(body.limit).toBe(10);
      expect(body.offset).toBe(0);
    });

    it('должен возвращать пустой список', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '0' }] };}
        return { rows: [] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/artists',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(0);
      expect(response.json().artists).toEqual([]);
    });
  });

  describe('GET /api/v1/library/artists/:id', () => {
    it('должен возвращать 404 при отсутствии артиста', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/artists/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('not_found');
      expect(response.json().error.message).toBe('Артист не найден');
    });

    it('должен возвращать детализированную информацию об артисте', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'artists WHERE id')) {
          return { rows: [{ id: 'a1', name: 'Test Artist', sort_name: 'Test, Artist', musicbrainz_artist_id: null, created_at: '2024-01-01', updated_at: '2024-01-01' }] };
        }
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '3' }] };}
        return { rows: [{ id: 'r1', title: 'Song A', duration_ms: 180000, musicbrainz_recording_id: null, created_at: '2024-01-01' }, { id: 'r2', title: 'Song B', duration_ms: 210000, musicbrainz_recording_id: null, created_at: '2024-01-02' }] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/artists/a1?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.artist.name).toBe('Test Artist');
      expect(body.artist.sort_name).toBe('Test, Artist');
      expect(body.recordings).toHaveLength(2);
      expect(body.total).toBe(3);
    });
  });

  describe('GET /api/v1/library/recordings/:id', () => {
    it('должен возвращать 404 при отсутствии записи', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async () => ({ rows: [] }));

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/recordings/nonexistent-id',
      });

      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('not_found');
      expect(response.json().error.message).toBe('Запись не найдена');
    });

    it('должен возвращать запись с медиа-активами', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'recordings r')) {
          return { rows: [{ id: 'r1', title: 'Test Song', duration_ms: 180000, musicbrainz_recording_id: null, created_at: '2024-01-01', artist_id: 'a1', artist_name: 'Test Artist' }] };
        }
        return { rows: [{ id: 'ma1', relative_path: '/music/test.mp3', format: 'mp3', size_bytes: 3600000, sha256: 'abc123', bitrate_kbps: 320, sample_rate_hz: 44100, channels: 2, duration_ms: 180000, status: 'available' }] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/recordings/r1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.recording.title).toBe('Test Song');
      expect(body.recording.artist_name).toBe('Test Artist');
      expect(body.media_assets).toHaveLength(1);
      expect(body.media_assets[0].format).toBe('mp3');
    });
  });

  describe('GET /api/v1/library/releases', () => {
    it('должен возвращать список релизов', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '2' }] };}
        return { rows: [{ id: 're1', title: 'Album One', release_type: 'album', release_date: '2024-06-01', artist_name: 'Artist A' }] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/releases?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(2);
      expect(response.json().releases).toHaveLength(1);
    });
  });

  describe('GET /api/v1/library/recordings', () => {
    it('должен возвращать список записей', async () => {
      const app = createApp();
      app.dependencies.database.pool.query = vi.fn(async (sql) => {
        if (includesSql(sql, 'count(*)')) {return { rows: [{ total: '4' }] };}
        return { rows: [{ id: 'r1', title: 'Song A', duration_ms: 180000, artist_name: 'Artist A', artist_id: 'a1' }] };
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/library/recordings?limit=10&offset=0',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().total).toBe(4);
      expect(response.json().recordings).toHaveLength(1);
    });
  });
});
