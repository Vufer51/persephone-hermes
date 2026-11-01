import { findUserByEmail } from './user-service.js';
import { createSession, revokeSession } from './session-service.js';
import { verifyPassword, hashToken } from './crypto.js';

/**
 * Схема валидации данных логина (JSON Schema).
 */
export const loginSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: {
      type: 'string',
      format: 'email',
      maxLength: 254,
    },
    password: {
      type: 'string',
      minLength: 1,
      maxLength: 128,
    },
  },
};

/**
 * Обрабатывает запрос на логин.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database, redis } = app.dependencies;
  const { pool } = database;
  const sessionTtlDays = app.config.auth?.sessionTtlDays ?? 7;

  app.post('/api/v1/auth/login', {
    schema: loginSchema,
    handler: async (request, reply) => {
      const { email, password } = request.body;

      // Находим пользователя
      const user = await findUserByEmail(pool, email.trim().toLowerCase());
      if (!user) {
        reply.code(401).send({
          error: {
            code: 'invalid_credentials',
            message: 'Неверный email или пароль',
            requestId: request.id,
          },
        });
        return;
      }

      // Проверяем, не отключён ли аккаунт
      if (user.status === 'disabled') {
        reply.code(403).send({
          error: {
            code: 'account_disabled',
            message: 'Аккаунт отключён',
            requestId: request.id,
          },
        });
        return;
      }

      // Проверяем пароль
      const valid = await verifyPassword(password, user.password_hash);
      if (!valid) {
        reply.code(401).send({
          error: {
            code: 'invalid_credentials',
            message: 'Неверный email или пароль',
            requestId: request.id,
          },
        });
        return;
      }

      // Обновляем last_login_at
      await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

      // Создаём сессию
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + sessionTtlDays);

      const session = await createSession(
        pool,
        user.id,
        request.headers['user-agent'] || null,
        request.ip || null,
        expiresAt
      );

      // Кэшируем токен в Redis
      if (redis) {
        const ttl = Math.min(600, Math.max(0, Math.floor((expiresAt - new Date()) / 1000)));
        if (ttl > 0) {
          await redis.setex(`token:${hashToken(session.token)}`, ttl, JSON.stringify({ userId: user.id }));
        }
      }

      // Безопасный ответ
      reply.code(200).send({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
          createdAt: user.created_at,
          lastLoginAt: user.last_login_at,
        },
        session: {
          token: session.token,
          expiresAt: session.expiresAt,
        },
      });
    },
  });

  // GET /api/v1/auth/me
  app.get('/api/v1/auth/me', {
    preHandler: [app.authMiddleware],
    handler: async (request) => {
      return {
        user: {
          id: request.user.id,
          email: request.user.email,
          username: request.user.username,
          role: request.user.role,
        },
      };
    },
  });

  // POST /api/v1/auth/logout
  app.post('/api/v1/auth/logout', {
    preHandler: [app.authMiddleware],
    handler: async (request, reply) => {
      await revokeSession(pool, request.sessionId);

      // Очищаем кэш Redis
      if (redis) {
        const tokenHash = request.headers['x-token-hash'];
        if (tokenHash) {
          await redis.del(`token:${tokenHash}`);
        }
      }

      reply.code(200).send({
        message: 'Выход выполнен успешно',
        requestId: request.id,
      });
    },
  });
}
