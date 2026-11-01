import {
  STORAGE_ROOT_TYPES,
  STORAGE_ROOT_STATUSES,
  createStorageRoot,
  findStorageRootById,
  findStorageRootByName,
  listStorageRoots,
  updateStorageRootStatus,
  deleteStorageRoot,
} from './storage-root-service.js';

/**
 * Регистрирует маршруты управления хранилищами.
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const { pool } = database;

  // POST /api/v1/storage-roots
  app.post('/api/v1/storage-roots', {
    schema: {
      body: {
        type: 'object',
        required: ['name', 'type', 'identifier'],
        properties: {
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 255,
            pattern: '^[a-zA-Z0-9_\\-]+$',
          },
          type: {
            type: 'string',
            enum: STORAGE_ROOT_TYPES,
          },
          identifier: {
            type: 'string',
            minLength: 1,
            maxLength: 1024,
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { name, type, identifier } = request.body;

      // Проверяем уникальность имени
      const existing = await findStorageRootByName(pool, name);
      if (existing) {
        reply.code(409).send({
          error: {
            code: 'name_already_exists',
            message: `Хранилище с именем "${name}" уже существует`,
            requestId: request.id,
          },
        });
        return;
      }

      const storageRoot = await createStorageRoot(pool, { name, type, identifier });

      reply.code(201).send(storageRoot);
    },
  });

  // GET /api/v1/storage-roots
  app.get('/api/v1/storage-roots', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: STORAGE_ROOT_STATUSES,
          },
        },
      },
    },
    handler: async (request) => {
      const { status } = request.query;
      const options = status ? { status } : {};

      const roots = await listStorageRoots(pool, options);

      return {
        storageRoots: roots,
        total: roots.length,
      };
    },
  });

  // GET /api/v1/storage-roots/:id
  app.get('/api/v1/storage-roots/:id', {
    schema: {
      params: {
        type: 'object',
        properties: {
          id: { type: 'string' },
        },
        required: ['id'],
      },
    },
    handler: async (request, reply) => {
      const storageRoot = await findStorageRootById(pool, request.params.id);

      if (!storageRoot) {
        reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      return storageRoot;
    },
  });

  // PATCH /api/v1/storage-roots/:id
  app.patch('/api/v1/storage-roots/:id', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: {
            type: 'string',
            enum: STORAGE_ROOT_STATUSES,
          },
        },
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { status } = request.body;

      const existing = await findStorageRootById(pool, id);

      if (!existing) {
        reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      if (existing.status === 'disabled') {
        reply.code(409).send({
          error: {
            code: 'storage_root_disabled',
            message: `Хранилище "${existing.name}" отключено`,
            requestId: request.id,
          },
        });
        return;
      }

      const updated = await updateStorageRootStatus(pool, id, status);

      return {
        ...updated,
        message: 'Статус хранилища обновлён',
      };
    },
  });

  // DELETE /api/v1/storage-roots/:id
  app.delete('/api/v1/storage-roots/:id', {
    handler: async (request, reply) => {
      const { id } = request.params;

      const existing = await findStorageRootById(pool, id);

      if (!existing) {
        reply.code(404).send({
          error: {
            code: 'not_found',
            message: 'Хранилище не найдено',
            requestId: request.id,
          },
        });
        return;
      }

      if (existing.status !== 'active') {
        reply.code(409).send({
          error: {
            code: 'storage_root_not_active',
            message: `Хранилище "${existing.name}" не находится в активном состоянии`,
            requestId: request.id,
          },
        });
        return;
      }

      const deleted = await deleteStorageRoot(pool, id);

      if (!deleted) {
        reply.code(409).send({
          error: {
            code: 'already_disabled',
            message: 'Хранилище уже отключено',
            requestId: request.id,
          },
        });
        return;
      }

      reply.code(200).send({
        message: `Хранилище "${existing.name}" отключено`,
        id,
      });
    },
  });
}
