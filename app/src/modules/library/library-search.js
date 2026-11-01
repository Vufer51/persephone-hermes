import {
  searchLibrary,
  listArtists,
  getArtist,
  getRecording,
  listReleases,
  listRecordings,
} from './library-search-service.js';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Регистрирует маршруты поиска и просмотра библиотеки.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { pool } = database;

  // GET /api/v1/library/search
  app.get('/api/v1/library/search', {
    schema: {
      querystring: {
        type: 'object',
        required: ['q'],
        properties: {
          q: { type: 'string', minLength: 1, maxLength: 256 },
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const { q, limit, offset } = request.query;
      const results = await searchLibrary(pool, q, limit, offset);

      return {
        query: q,
        limit,
        offset,
        ...results,
      };
    },
  });

  // GET /api/v1/library/artists
  app.get('/api/v1/library/artists', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const { limit, offset } = request.query;
      const result = await listArtists(pool, limit, offset);

      return {
        limit,
        offset,
        ...result,
      };
    },
  });

  // GET /api/v1/library/artists/:id
  app.get('/api/v1/library/artists/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { limit, offset } = request.query;

      const result = await getArtist(pool, id, limit, offset);

      if (result.artist === null) {
        reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Артист не найден',
            requestId: request.id,
          },
        });
        return;
      }

      return {
        limit,
        offset,
        ...result,
      };
    },
  });

  // GET /api/v1/library/recordings/:id
  app.get('/api/v1/library/recordings/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const result = await getRecording(pool, id);

      if (result.recording === null) {
        reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Запись не найдена',
            requestId: request.id,
          },
        });
        return;
      }

      return {
        recording: result.recording,
        media_assets: result.media_assets,
      };
    },
  });

  // GET /api/v1/library/releases
  app.get('/api/v1/library/releases', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const { limit, offset } = request.query;
      const result = await listReleases(pool, limit, offset);

      return {
        limit,
        offset,
        ...result,
      };
    },
  });

  // GET /api/v1/library/recordings
  app.get('/api/v1/library/recordings', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const { limit, offset } = request.query;
      const result = await listRecordings(pool, limit, offset);

      return {
        limit,
        offset,
        ...result,
      };
    },
  });
}
