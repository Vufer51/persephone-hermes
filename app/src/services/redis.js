import { Redis } from 'ioredis';
import { withTimeout } from '../utils/timeout.js';

/**
 * Создаёт клиент Redis.
 *
 * Для API используется короткий commandTimeout, чтобы readiness не зависал.
 * Для BullMQ необходимо передать `maxRetriesPerRequest: null`.
 *
 * @param {string} url
 * @param {{
 *   logger?: { warn: Function, error: Function } | null,
 *   maxRetriesPerRequest?: number | null,
 *   commandTimeout?: number | null,
 *   connectTimeout?: number,
 * }} [options]
 */
export function createRedisClient(url, options = {}) {
  const {
    logger = null,
    maxRetriesPerRequest = 1,
    commandTimeout = 3000,
    connectTimeout = 5000,
  } = options;

  const redisOptions = {
    maxRetriesPerRequest,
    connectTimeout,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  };

  // В ioredis `commandTimeout: 0` означает немедленный таймаут, а не его отсутствие.
  // Для блокирующих команд BullMQ таймаут нужно не задавать вовсе.
  if (typeof commandTimeout === 'number' && commandTimeout > 0) {
    redisOptions.commandTimeout = commandTimeout;
  }

  const client = new Redis(url, redisOptions);

  client.on('error', (error) => {
    logger?.warn({ err: error }, 'ошибка соединения с Redis');
  });

  return client;
}

/**
 * Проверка доступности Redis для readiness.
 *
 * @param {Redis} client
 * @param {number} [timeoutMs]
 */
export async function pingRedis(client, timeoutMs = 2000) {
  await withTimeout(client.ping(), timeoutMs, 'проверка Redis');
}

/**
 * Корректно закрывает клиент Redis.
 * @param {Redis} client
 */
export async function closeRedis(client) {
  try {
    await client.quit();
  } catch {
    client.disconnect();
  }
}
