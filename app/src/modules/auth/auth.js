import { hashToken } from './crypto.js';
import { touchSession } from './session-service.js';

const AUTH_HEADER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Middleware для проверки авторизации.
 * Извлекает токен из заголовка Authorization, находит сессию и прикрепляет
 * пользователя к request.user.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {import('ioredis').Redis} redis — Redis-клиент (для опционального кэша сессий)
 * @returns {Function} Fastify-хук-дополнение
 */
export function createAuthMiddleware(pool, redis) {
  return async function authMiddleware(request, reply) {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      reply.code(401).send({
        error: {
          code: 'unauthorized',
          message: 'Необходима авторизация',
          requestId: request.id,
        },
      });
      throw new Error('unauthorized');
    }

    const match = AUTH_HEADER_PATTERN.exec(authHeader);
    if (!match) {
      reply.code(401).send({
        error: {
          code: 'invalid_token',
          message: 'Некорректный формат токена. Используйте: Bearer <token>',
          requestId: request.id,
        },
      });
      throw new Error('invalid_token');
    }

    const token = match[1];
    const tokenHash = hashToken(token);

    // Проверяем кэш сессий в Redis (опционально, ускорение)
    if (redis) {
      const cachedSession = await redis.get(`session:${tokenHash}`);
      if (cachedSession) {
        const sessionData = JSON.parse(cachedSession);
        request.user = sessionData;
        request.sessionId = sessionData.sessionId;
        return;
      }
    }

    // Основной путь: запрос к PostgreSQL
    const session = await findSession(pool, tokenHash);

    if (!session) {
      reply.code(401).send({
        error: {
          code: 'invalid_token',
          message: 'Токен недействителен',
          requestId: request.id,
        },
      });
      throw new Error('invalid_token');
    }

    if (session.user_status === 'disabled') {
      reply.code(403).send({
        error: {
          code: 'account_disabled',
          message: 'Аккаунт отключён',
          requestId: request.id,
        },
      });
      throw new Error('account_disabled');
    }

    // Обновляем last_used_at для сессии
    await touchSession(pool, session.sessionId);

    // Обновляем last_login_at для пользователя
    await updateLastLogin(pool, session.userId);

    // Сохраняем данные в request для дальнейшего использования
    request.user = {
      id: session.userId,
      email: session.email,
      username: session.username,
      role: session.role,
    };

    request.sessionId = session.sessionId;

    // Кэшируем сессию в Redis (TTL = 60 секунд, для ускорения последующих запросов)
    if (redis) {
      const ttl = Math.min(60, Math.max(0, Math.floor((session.expiresAt - new Date()) / 1000)));
      if (ttl > 0) {
        const sessionData = { ...request.user, sessionId: session.sessionId, expiresAt: session.expiresAt };
        await redis.setex(`session:${tokenHash}`, ttl, JSON.stringify(sessionData));
      }
    }
  };
}

/**
 * Находит сессию по хешу токена.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} tokenHash — хеш токена
 * @returns {Promise<object|null>} сессия с пользователем или null
 */
async function findSession(pool, tokenHash) {
  const result = await pool.query(
    `SELECT s.id AS session_id, s.user_id AS user_id, s.expires_at,
            u.email, u.username, u.role, u.status AS user_status
     FROM user_sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1
       AND s.revoked_at IS NULL
       AND s.expires_at > NOW()`,
    [tokenHash]
  );

  return result.rows[0] ?? null;
}

/**
 * Обновляет дату последнего входа пользователя.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} userId — UUID пользователя
 */
async function updateLastLogin(pool, userId) {
  await pool.query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [userId]
  );
}
