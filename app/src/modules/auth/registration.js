import { createUser, findUserByEmail } from './user-service.js';
import { createSession } from './session-service.js';
import { hashToken } from './crypto.js';

const MIN_PASSWORD_LENGTH = 8;
const MAX_USERNAME_LENGTH = 64;

/**
 * Схема валидации данных регистрации (JSON Schema).
 */
export const registrationSchema = {
  type: 'object',
  required: ['email', 'password'],
  properties: {
    email: {
      type: 'string',
      format: 'email',
      maxLength: 254,
    },
    username: {
      type: 'string',
      minLength: 3,
      maxLength: MAX_USERNAME_LENGTH,
      pattern: /^[a-zA-Z0-9_]+$/,
    },
    password: {
      type: 'string',
      minLength: MIN_PASSWORD_LENGTH,
      maxLength: 128,
    },
  },
};

/**
 * Валидирует email.
 *
 * @param {string} email
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateEmail(email) {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email обязателен' };
  }

  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailPattern.test(email)) {
    return { valid: false, error: 'Некорректный формат email' };
  }

  if (email.length > 254) {
    return { valid: false, error: 'Email слишком длинный (максимум 254 символа)' };
  }

  return { valid: true };
}

/**
 * Валидирует пароль.
 *
 * @param {string} password
 * @returns {{ valid: boolean; error?: string }}
 */
export function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Пароль обязателен' };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      valid: false,
      error: `Пароль должен содержать не менее ${MIN_PASSWORD_LENGTH} символов`,
    };
  }

  if (password.length > 128) {
    return { valid: false, error: 'Пароль слишком длинный (максимум 128 символов)' };
  }

  return { valid: true };
}

/**
 * Валидирует имя пользователя.
 *
 * @param {string} [username]
 * @returns {{ valid: boolean; error?: string }}
 */
export function validateUsername(username) {
  if (!username) {
    return { valid: true }; // опционально
  }

  if (username.length < 3) {
    return { valid: false, error: 'Имя пользователя должно содержать не менее 3 символов' };
  }

  if (username.length > MAX_USERNAME_LENGTH) {
    return { valid: false, error: 'Имя пользователя слишком длинное (максимум 64 символа)' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return { valid: false, error: "Имя пользователя может содержать только буквы, цифры и _" };
  }

  return { valid: true };
}

/**
 * Обрабатывает запрос на регистрацию.
 *
 * @param {import('fastify').FastifyInstance} app — экземпляр приложения
 */
export function registerRoutes(app) {
  const { database, redis } = app.dependencies;
  const { pool } = database;
  const sessionTtlDays = app.config.auth?.sessionTtlDays ?? 7;

  app.post('/api/v1/auth/register', {
    schema: registrationSchema,
    handler: async (request, reply) => {
      // Быстрая проверка: пользователь уже зарегистрирован?
      const existing = await findUserByEmail(pool, request.body.email);
      if (existing) {
        reply.code(409).send({
          error: {
            code: 'email_already_exists',
            message: 'Пользователь с таким email уже зарегистрирован',
            requestId: request.id,
          },
        });
        return;
      }

      // Валидация
      const emailValidation = validateEmail(request.body.email);
      if (!emailValidation.valid) {
        reply.code(422).send({
          error: {
            code: 'validation_error',
            message: emailValidation.error,
            requestId: request.id,
            details: [{ field: 'email', issue: emailValidation.error }],
          },
        });
        return;
      }

      const passwordValidation = validatePassword(request.body.password);
      if (!passwordValidation.valid) {
        reply.code(422).send({
          error: {
            code: 'validation_error',
            message: passwordValidation.error,
            requestId: request.id,
            details: [{ field: 'password', issue: passwordValidation.error }],
          },
        });
        return;
      }

      const usernameValidation = validateUsername(request.body.username);
      if (!usernameValidation.valid) {
        reply.code(422).send({
          error: {
            code: 'validation_error',
            message: usernameValidation.error,
            requestId: request.id,
            details: [{ field: 'username', issue: usernameValidation.error }],
          },
        });
        return;
      }

      // Регистрация пользователя
      const user = await createUser(pool, {
        email: request.body.email.trim().toLowerCase(),
        username: request.body.username?.trim() || null,
        password: request.body.password,
      });

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

      // Кэшируем токен в Redis (безопасно: только хеш токена как ключ)
      if (redis) {
        const ttl = Math.min(600, Math.max(0, Math.floor((expiresAt - new Date()) / 1000)));
        if (ttl > 0) {
          await redis.setex(`token:${hashToken(session.token)}`, ttl, JSON.stringify({ userId: user.id }));
        }
      }

      // Безопасный ответ (без sensitive данных)
      reply.code(201).send({
        user: {
          id: user.id,
          email: user.email,
          username: user.username,
          role: user.role,
          status: user.status,
          createdAt: user.created_at,
        },
        session: {
          token: session.token, // токен возвращается только один раз!
          expiresAt: session.expiresAt,
        },
      });
    },
  });
}
