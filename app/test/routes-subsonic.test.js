import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(overrides = {}) {
  const mockPool = {
    query: vi.fn(async () => ({ rows: [] })),
  };
  const mockDatabase = { pool: mockPool, ping: vi.fn(async () => {}) };
  const mockRedis = {
    ping: vi.fn(async () => {}),
    setex: vi.fn(),
    del: vi.fn(),
    get: vi.fn(),
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
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('Subsonic API routes', () => {
  describe('GET /rest/ping', () => {
    it('должен возвращать статус ok без аутентификации', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/ping',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/getLicenses', () => {
    it('должен возвращать информацию о лицензии', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/getLicenses',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/getMusicFolders', () => {
    it('должен возвращать список папок с музыкой', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/getMusicFolders',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/search3', () => {
    it('должен возвращать 400 без параметра query', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/search3',
      });

      expect(response.statusCode).toBe(400);
    });

    it('должен возвращать результаты поиска', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/rest/search3?query=test',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/getAlbumList', () => {
    it('должен возвращать список альбомов', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/getAlbumList',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/getArtist', () => {
    it('должен возвращать failed если исполнитель не найден', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async () => ({ rows: [] })),
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/rest/getArtist?id=nonexistent',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('failed');
    });
  });

  describe('GET /rest/playQueue', () => {
    it('должен возвращать очередь воспроизведения', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async () => ({ rows: [] })),
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/rest/playQueue',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/getStreamUrl', () => {
    it('должен возвращать failed если медиа-ассет не найден', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async () => ({ rows: [] })),
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/rest/getStreamUrl?id=11111111-1111-1111-1111-111111111111',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('failed');
    });
  });

  describe('GET /rest/getCoverArt', () => {
    it('должен возвращать информацию об обложке', async () => {
      const app = createApp();
      const response = await app.inject({
        method: 'GET',
        url: '/rest/getCoverArt?id=11111111-1111-1111-1111-111111111111',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });

  describe('GET /rest/scrobble', () => {
    it('должен возвращать ok при отправке скроббла', async () => {
      const app = createApp({
        database: {
          pool: {
            query: vi.fn(async () => ({ rows: [] })),
          },
        },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/rest/scrobble?time=1234567890&ids=track1,track2',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.status).toBe('ok');
    });
  });
});
