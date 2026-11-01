import { createPlaybackService } from './playback-service.js';

/**
 * Регистрирует маршруты воспроизведения.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { config } = app;
  const playbackService = createPlaybackService({ pool: database.pool, config });

  // POST /api/v1/playback/sessions — старт сессии
  app.post('/api/v1/playback/sessions', {
    schema: {
      body: {
        type: 'object',
        required: ['recordingId', 'mediaAssetId'],
        properties: {
          recordingId: { type: 'string', format: 'uuid' },
          mediaAssetId: { type: 'string', format: 'uuid' },
          startPositionMs: { type: 'integer', minimum: 0, default: 0 },
          source: { type: 'string', enum: ['web', 'subsonic', 'api'], default: 'api' },
        },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { recordingId, mediaAssetId, startPositionMs = 0, source = 'api' } = request.body;

      try {
        const session = await playbackService.startSession({
          userId,
          recordingId,
          mediaAssetId,
          startPositionMs,
          source,
        });
        return { session };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to start playback session', requestId: request.id },
        });
      }
    },
  });

  // PATCH /api/v1/playback/sessions/:id — heartbeat (обновление позиции)
  app.patch('/api/v1/playback/sessions/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['positionMs'],
        properties: { positionMs: { type: 'integer', minimum: 0 } },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { id: sessionId } = request.params;
      const { positionMs } = request.body;

      // Проверяем владельца сессии
      const sessionResult = await database.pool.query(
        `SELECT * FROM playback_sessions WHERE id = $1 AND user_id = $2 AND ended_at IS NULL`,
        [sessionId, userId],
      );

      if (sessionResult.rows.length === 0) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Active session not found', requestId: request.id },
        });
      }

      try {
        const updated = await playbackService.updatePosition(sessionId, positionMs);
        return { session: updated };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to update position', requestId: request.id },
        });
      }
    },
  });

  // DELETE /api/v1/playback/sessions/:id — завершение сессии
  app.delete('/api/v1/playback/sessions/:id', {
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: { endPositionMs: { type: 'integer', minimum: 0 } },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { id: sessionId } = request.params;
      const endPositionMs = request.query.endPositionMs ? parseInt(request.query.endPositionMs, 10) : null;

      const sessionResult = await database.pool.query(
        `SELECT * FROM playback_sessions WHERE id = $1 AND user_id = $2`,
        [sessionId, userId],
      );

      if (sessionResult.rows.length === 0) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'Session not found', requestId: request.id },
        });
      }

      try {
        const ended = await playbackService.endSession(sessionId, endPositionMs);
        return { session: ended };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to end session', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/playback/stream/:mediaAssetId — прокси стрима с поддержкой Range
  app.get('/api/v1/playback/stream/:mediaAssetId', {
    schema: {
      params: {
        type: 'object',
        required: ['mediaAssetId'],
        properties: { mediaAssetId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: { timeOffset: { type: 'integer', minimum: 0 } },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const { mediaAssetId } = request.params;

      try {
        const stream = await playbackService.proxyStream(mediaAssetId, request, reply);
        return stream;
      } catch (err) {
        request.log.error(err);
        if (err.message.includes('not found')) {
          return reply.code(404).send({
            error: { code: 'not_found', message: err.message, requestId: request.id },
          });
        }
        return reply.code(502).send({
          error: { code: 'upstream_error', message: 'Failed to proxy stream', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/playback/history — история воспроизведения
  app.get('/api/v1/playback/history', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      const { limit = 50, offset = 0 } = request.query;
      return playbackService.getHistory(userId, { limit, offset });
    },
  });

  // GET /api/v1/playback/sessions/active — активная сессия
  app.get('/api/v1/playback/sessions/active', {
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      const userId = request.user.id;
      const session = await playbackService.getActiveSession(userId);
      return { session };
    },
  });

  // GET /api/v1/playback/now-playing — текущий трек (Now Playing)
  app.get('/api/v1/playback/now-playing', {
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      const userId = request.user.id;
      const nowPlaying = await playbackService.getNowPlaying(userId);

      if (!nowPlaying) {
        return reply.code(404).send({
          error: { code: 'not_found', message: 'No active playback', requestId: request.id },
        });
      }

      return { now_playing: nowPlaying };
    },
  });
}