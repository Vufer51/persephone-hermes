import { createPlayerService } from './player-service.js';

/**
 * Регистрирует маршруты Web Player.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { config } = app;
  const playerService = createPlayerService({ pool: database.pool, config });

  // GET /api/v1/player/stream/:mediaAssetId — URL стрима для HTML5 аудио плеера
  app.get('/api/v1/player/stream/:mediaAssetId', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['mediaAssetId'],
        properties: { mediaAssetId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          timeOffset: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { mediaAssetId } = request.params;
      const { timeOffset } = request.query;

      try {
        const streamUrl = await playerService.getStreamUrl(mediaAssetId, { timeOffset });
        return { streamUrl };
      } catch (err) {
        request.log.error(err);
        if (err.message === 'Media asset not found') {
          return reply.code(404).send({
            error: { code: 'not_found', message: err.message, requestId: request.id },
          });
        }
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to get stream URL', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/player/now-playing — текущий трек (Now Playing) для веб-плеера
  app.get('/api/v1/player/now-playing', {
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const nowPlaying = await playerService.getNowPlaying(userId);

      if (!nowPlaying) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'No active playback', requestId: request.id },
        });
      }

      return { nowPlaying };
    },
  });

  // GET /api/v1/player/history — история воспроизведения для веб-плеера
  app.get('/api/v1/player/history', {
    preHandler: [app.authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const userId = request.user.id;
      const { limit = 50, offset = 0 } = request.query;
      return playerService.getHistory(userId, { limit, offset });
    },
  });

  // GET /api/v1/player/assets — список доступных медиа-ассетов
  app.get('/api/v1/player/assets', {
    preHandler: [app.authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    handler: async (request) => {
      const userId = request.user.id;
      const { limit = 20, offset = 0 } = request.query;
      return playerService.getAvailableAssets(userId, { limit, offset });
    },
  });
}