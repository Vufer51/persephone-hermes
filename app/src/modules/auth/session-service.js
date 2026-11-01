import { generateToken, hashToken, generateSessionId } from './crypto.js';

/**
 * Создает новую сессию для пользователя.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} userId — UUID пользователя
 * @param {string} userAgent — User-Agent клиента
 * @param {string} ip — IP-адрес клиента
 * @param {Date} expiresAt — дата истечения сессии
 * @returns {Promise<object>} сессия с { id, token, tokenHash, userId, expiresAt }
 */
export async function createSession(pool, userId, userAgent, ip, expiresAt) {
  const token = generateToken();
  const tokenHash = hashToken(token);
  const sessionId = generateSessionId();

  await pool.query(
    `INSERT INTO user_sessions (id, user_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, userId, tokenHash, userAgent || null, ip || null, expiresAt]
  );

  return { id: sessionId, token, tokenHash, userId, expiresAt };
}

/**
 * Находит активную сессию по токену (хешированному).
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} tokenHash — хеш токена
 * @returns {Promise<object|null>} сессия или null
 */
export async function findSessionByToken(pool, tokenHash) {
  const result = await pool.query(
    `SELECT s.id, s.user_id, s.expires_at, s.last_used_at,
            u.id AS user_id, u.email, u.username, u.role, u.status AS user_status
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
 * Отозывает сессию (помечает как аннулированную).
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} sessionId — UUID сессии
 */
export async function revokeSession(pool, sessionId) {
  await pool.query(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL`,
    [sessionId]
  );
}

/**
 * Обновляет дату последнего использования сессии.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} sessionId — UUID сессии
 */
export async function touchSession(pool, sessionId) {
  await pool.query(
    'UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1',
    [sessionId]
  );
}

/**
 * Удаляет просроченные сессии.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @returns {Promise<number>} количество удалённых записей
 */
export async function cleanupExpiredSessions(pool) {
  const result = await pool.query(
    `DELETE FROM user_sessions
     WHERE revoked_at IS NULL AND expires_at < NOW()`,
    []
  );

  return result.rowCount;
}

/**
 * Аннулирует все сессии пользователя (при выходе или смене пароля).
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} userId — UUID пользователя
 */
export async function revokeAllUserSessions(pool, userId) {
  await pool.query(
    `UPDATE user_sessions
     SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}
