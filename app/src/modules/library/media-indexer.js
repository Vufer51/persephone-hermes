import {
  indexStorageRoot,
  stopIndexing,
  getIndexingStatus,
} from './media-indexer-service.js';

/**
 * Регистрирует маршруты индексирования медиа-файлов.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { pool } = database;

  // POST /api/v1/index
  app.post('/api/v1/index', {
    schema: {
      body: {
        type: 'object',
        required: ['storage_root_id'],
        properties: {
          storage_root_id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { storage_root_id } = request.body;

      const root = await pool.query('SELECT id, name, identifier, status FROM storage_roots WHERE id = $1', [storage_root_id]);
      if (root.rows.length === 0) {
        reply.code(404).send({
          error: {
            code: 'storage_root_not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      const { status } = root.rows[0];
      if (status !== 'active') {
        reply.code(409).send({
          error: {
            code: 'storage_root_not_active',
            message: `Хранилище "${root.rows[0].name}" не находится в активном состоянии`,
            requestId: request.id,
          },
        });
        return;
      }

      // Устанавливаем статус maintenance на время индексации
      await pool.query("UPDATE storage_roots SET status = 'maintenance' WHERE id = $1", [storage_root_id]);

      try {
        const result = await indexStorageRoot(pool, storage_root_id, root.rows[0].identifier);

        await pool.query("UPDATE storage_roots SET status = 'active' WHERE id = $1", [storage_root_id]);

        reply.code(200).send({
          message: 'Индексирование завершено',
          ...result,
        });
      } catch (error) {
        await pool.query("UPDATE storage_roots SET status = 'active' WHERE id = $1", [storage_root_id]);

        reply.code(500).send({
          error: {
            code: 'indexing_failed',
            message: error.message || 'Ошибка индексирования',
            requestId: request.id,
          },
        });
      }
    },
  });

  // POST /api/v1/index/stop
  app.post('/api/v1/index/stop', {
    schema: {
      body: {
        type: 'object',
        required: ['storage_root_id'],
        properties: {
          storage_root_id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { storage_root_id } = request.body;

      const root = await pool.query('SELECT id, name FROM storage_roots WHERE id = $1', [storage_root_id]);
      if (root.rows.length === 0) {
        reply.code(404).send({
          error: {
            code: 'storage_root_not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      const stopped = await stopIndexing(pool, storage_root_id);

      if (!stopped) {
        reply.code(409).send({
          error: {
            code: 'not_indexing',
            message: `Хранилище "${root.rows[0].name}" не индексируется`,
            requestId: request.id,
          },
        });
        return;
      }

      reply.code(200).send({
        message: `Индексирование "${root.rows[0].name}" остановлено`,
      });
    },
  });

  // GET /api/v1/index/status
  app.get('/api/v1/index/status', {
    schema: {
      querystring: {
        type: 'object',
        required: ['storage_root_id'],
        properties: {
          storage_root_id: { type: 'string' },
        },
      },
    },
    handler: async (request, reply) => {
      const { storage_root_id } = request.query;

      const status = await getIndexingStatus(pool, storage_root_id);

      if (status === null) {
        reply.code(404).send({
          error: {
            code: 'storage_root_not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      return { storage_root_id, status };
    },
  });
}
