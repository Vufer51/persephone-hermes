import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { createLoggerOptions } from '../utils/logger.js';
import { registerHealthRoutes } from './routes/health.js';
import { createAuthMiddleware } from '../modules/auth/auth.js';
import { registerRoutes as registerRegistrationRoutes } from '../modules/auth/registration.js';
import { registerRoutes as registerLoginRoutes } from '../modules/auth/login.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Собирает Fastify-приложение. Зависимости передаются явно из composition root.
 *
 * @param {{
 *   config: ReturnType<typeof import('../config/index.js').loadConfig>,
 *   database: { ping: () => Promise<void> },
 *   redis: { ping: () => Promise<void> },
 *   logger?: object | false,
 * }} options
 */
export function buildApp({ config, database, redis, logger }) {
  const app = Fastify({
    logger: logger ?? createLoggerOptions(config),
    genReqId: (request) => normalizeRequestId(request.headers['x-request-id']),
    trustProxy: true,
  });

  app.decorate('config', config);
  app.decorate('dependencies', { database, redis });
  app.decorate('authMiddleware', createAuthMiddleware(database.pool, redis));

  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('x-request-id', request.id);
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    return payload;
  });

  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      error: {
        code: 'not_found',
        message: 'Маршрут не найден',
        requestId: request.id,
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const statusCode = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    const isServerError = statusCode >= 500;

    if (isServerError) {
      request.log.error({ err: error }, 'необработанная ошибка запроса');
    } else {
      request.log.warn({ err: error }, 'ошибка запроса');
    }

    reply.code(statusCode).send({
      error: {
        code: isServerError ? 'internal_error' : error.code ?? 'bad_request',
        message: isServerError ? 'Внутренняя ошибка сервера' : error.message,
        requestId: request.id,
      },
    });
  });

  registerHealthRoutes(app, { database, redis });

  // Регистрация маршрутов аутентификации
  registerRegistrationRoutes(app);
  registerLoginRoutes(app);

  return app;
}

/**
 * @param {unknown} value
 */
function normalizeRequestId(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (REQUEST_ID_PATTERN.test(trimmed)) {
      return trimmed;
    }
  }
  return randomUUID();
}
