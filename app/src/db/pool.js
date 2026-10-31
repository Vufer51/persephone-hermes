import pg from 'pg';
import { withTimeout } from '../utils/timeout.js';

const { Pool } = pg;

/**
 * Создаёт пул соединений PostgreSQL.
 *
 * @param {{
 *   url: string,
 *   max?: number,
 *   logger?: { error: Function },
 *   applicationName?: string,
 * }} options
 */
export function createPool({ url, max = 10, logger, applicationName = 'persephone' }) {
  const pool = new Pool({
    connectionString: url,
    max,
    application_name: applicationName,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  });

  pool.on('error', (error) => {
    logger?.error({ err: error }, 'неподключённый клиент PostgreSQL вернул ошибку');
  });

  return pool;
}

/**
 * Проверка доступности PostgreSQL для readiness.
 *
 * @param {import('pg').Pool} pool
 * @param {number} [timeoutMs]
 */
export async function pingDatabase(pool, timeoutMs = 2000) {
  await withTimeout(pool.query('SELECT 1'), timeoutMs, 'проверка PostgreSQL');
}
