import { createLidarrService } from './lidarr-service.js';

/**
 * Регистрирует маршруты для запросов на скачивание музыки через Lidarr.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { config } = app;
  const lidarrService = createLidarrService({ pool: database.pool, config });

  // GET /api/v1/downloads/requests — список запросов пользователя
  app.get('/api/v1/downloads/requests', {
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
      return lidarrService.getDownloadRequests(userId, { limit, offset });
    },
  });

  // POST /api/v1/downloads/requests — запросить скачивание исполнителя
  app.post('/api/v1/downloads/requests', {
    preHandler: [app.authMiddleware],
    schema: {
      body: {
        type: 'object',
        required: ['artistName'],
        properties: {
          recordingId: { type: 'string', format: 'uuid' },
          artistName: { type: 'string', minLength: 1, maxLength: 256 },
          artistMbId: { type: 'string', maxLength: 36 },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { recordingId, artistName, artistMbId } = request.body;

      try {
        const result = await lidarrService.requestDownload({
          userId,
          recordingId,
          artistName,
          artistMbId,
        });
        return result;
      } catch (err) {
        request.log.error(err);
        if (err.message.includes('не настроен')) {
          return reply.code(503).send({
            error: { code: 'service_unavailable', message: err.message, requestId: request.id },
          });
        }
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to request download', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/downloads/requests/:id — статус запроса
  app.get('/api/v1/downloads/requests/:id', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { id: requestId } = request.params;

      try {
        const request_ = await lidarrService.getDownloadRequest(requestId, userId);
        if (!request_) {
          return reply.code(404).send({
            error: { code: 'not_found', message: 'Download request not found', requestId: request.id },
          });
        }
        return { request: request_ };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to get download request', requestId: request.id },
        });
      }
    },
  });

  // DELETE /api/v1/downloads/requests/:id — отменить запрос
  app.delete('/api/v1/downloads/requests/:id', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { id: requestId } = request.params;

      try {
        const cancelled = await lidarrService.cancelDownloadRequest(requestId, userId);
        if (!cancelled) {
          return reply.code(404).send({
            error: { code: 'not_found', message: 'Download request not found or cannot be cancelled', requestId: request.id },
          });
        }
        return { cancelled: true, requestId };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to cancel download request', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/downloads/status — проверить, настроен ли Lidarr
  app.get('/api/v1/downloads/status', {
    preHandler: [app.authMiddleware],
    handler: async (_request) => {
      const configured = Boolean(
        config.integrations?.lidarr?.url && config.integrations?.lidarr?.apiKey
      );
      return {
        lidarrConfigured: configured,
        lidarrUrl: config.integrations?.lidarr?.url ?? null,
      };
    },
  });
}