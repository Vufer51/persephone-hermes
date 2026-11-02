import { createSubsonicClient } from './subsonic-client.js';

/**
 * Регистрирует маршруты совместимости с Subsonic API.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const subsonicClient = createSubsonicClient({ pool: database.pool, config: app.config });

  // GET /rest/ping — проверка соединения
  app.get('/rest/ping', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          p: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.ping();
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getLicenses — информация о лицензии
  app.get('/rest/getLicenses', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getLicenses();
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getMusicFolders — папки с музыкой
  app.get('/rest/getMusicFolders', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getMusicFolders();
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/search3 — поиск треков/артистов/альбомов
  app.get('/rest/search3', {
    schema: {
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          query: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { query: searchQuery, limit = 20, offset = 0 } = request.query;
      const result = await subsonicClient.search3({ query: searchQuery, limit, offset });
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getAlbumList — список альбомов
  app.get('/rest/getAlbumList', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          type: { type: 'string', default: 'alphabetical' },
          size: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getAlbumList(request.query);
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getArtist — информация об исполнителе
  app.get('/rest/getArtist', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id'],
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getArtist(request.query);
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/playQueue — очередь воспроизведения
  app.get('/rest/playQueue', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
        },
      },
    },
    handler: async (request, reply) => {
      const username = request.query.u || 'default';
      const userId = username; // В продакшене нужно resolve username -> userId
      const result = await subsonicClient.playQueue(userId);
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getStreamUrl — URL стрима в формате Subsonic
  app.get('/rest/getStreamUrl', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id'],
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          id: { type: 'string' },
          maxBitrate: { type: 'integer' },
          format: { type: 'boolean', default: false },
          timeOffset: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getStreamUrl(request.query);
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/getCoverArt — обложка альбома
  app.get('/rest/getCoverArt', {
    schema: {
      querystring: {
        type: 'object',
        required: ['id'],
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const result = await subsonicClient.getCoverArt(request.query);
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/scrobble — отправка скроббла (Subsonic совместимость)
  app.get('/rest/scrobble', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          u: { type: 'string' },
          t: { type: 'string' },
          v: { type: 'string', default: '1.16.1' },
          c: { type: 'string', default: 'persephone' },
          time: { type: 'string' },
          ids: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { u: username, time, ids } = request.query;
      const userId = username || 'default';
      const trackIds = ids ? ids.split(',') : [];
      const result = await subsonicClient.scrobble({ userId, time, ids: trackIds });
      reply.header('Content-Type', 'application/json');
      return result;
    },
  });

  // GET /rest/cover-art/:id — редирект на обложку
  app.get('/rest/cover-art/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      return reply.redirect(`/api/v1/subsonic/cover-art/${id}`);
    },
  });

  // GET /rest/stream/:id — стрим медиа-ассета
  app.get('/rest/stream/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
      },
      querystring: {
        type: 'object',
        properties: {
          timeOffset: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      return reply.redirect(`/api/v1/player/stream/${id}`);
    },
  });
}