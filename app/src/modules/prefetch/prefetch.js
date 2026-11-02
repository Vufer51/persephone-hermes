import { createPrefetchService } from './prefetch-service.js';

/**
 * Регистрирует маршруты предварительной загрузки контента (Prefetch Engine).
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const prefetchService = createPrefetchService({ pool: database.pool, config: app.config });

  // POST /api/v1/prefetch/jobs — создать задачу получения контента
  app.post('/api/v1/prefetch/jobs', {
    preHandler: [app.authMiddleware],
    schema: {
      body: {
        type: 'object',
        required: ['recordingId'],
        properties: {
          recordingId: { type: 'string', format: 'uuid' },
          reason: { type: 'string', enum: ['radio', 'playlist', 'recommendation', 'manual'], default: 'manual' },
          priority: { type: 'integer', default: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const userId = request.user.id;
      const { recordingId, reason = 'manual', priority = 0 } = request.body;

      try {
        const job = await prefetchService.createPrefetchJob(userId, recordingId, reason, priority);
        return { job };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to create prefetch job', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/prefetch/jobs — получить задачи пользователя
  app.get('/api/v1/prefetch/jobs', {
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
      return prefetchService.getPrefetchJobs(userId, { limit, offset });
    },
  });

  // GET /api/v1/prefetch/jobs/:id — детальная информация о задаче
  app.get('/api/v1/prefetch/jobs/:id', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
    },
    handler: async (request, reply) => {
      const { id: jobId } = request.params;

      try {
        const job = await prefetchService.getPrefetchJob(jobId);
        if (!job) {
          return reply.code(404).send({
            error: { code: 'not_found', message: 'Prefetch job not found', requestId: request.id },
          });
        }
        return { job };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to get prefetch job', requestId: request.id },
        });
      }
    },
  });

  // PATCH /api/v1/prefetch/jobs/:id/status — обновить статус задачи
  app.patch('/api/v1/prefetch/jobs/:id/status', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['pending', 'queued', 'running', 'completed', 'failed', 'cancelled'] },
          lastError: { type: 'string' },
          attemptCount: { type: 'integer', minimum: 0 },
        },
      },
    },
    handler: async (request, reply) => {
      const { id: jobId } = request.params;
      const { status, lastError = null, attemptCount = null } = request.body;

      try {
        await prefetchService.updateJobStatus(jobId, status, lastError, attemptCount);
        return { updated: true, jobId, status };
      } catch (err) {
        request.log.error(err);
        return reply.code(500).send({
          error: { code: 'internal_error', message: 'Failed to update job status', requestId: request.id },
        });
      }
    },
  });

  // GET /api/v1/prefetch/pending — получить ожидающие задачи (для worker)
  app.get('/api/v1/prefetch/pending', {
    preHandler: [app.authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 10 },
        },
      },
    },
    handler: async (request) => {
      const { limit = 10 } = request.query;
      return prefetchService.getPendingJobs(limit);
    },
  });
}