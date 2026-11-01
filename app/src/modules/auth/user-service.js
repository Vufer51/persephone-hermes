import { hashPassword } from './crypto.js';

/**
 * Создает нового пользователя.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {object} data — данные пользователя
 * @param {string} data.email — email пользователя
 * @param {string} data.username — имя пользователя (опционально)
 * @param {string} data.password — пароль (будет захеширован)
 * @returns {Promise<object>} созданный пользователь (без password_hash)
 */
export async function createUser(pool, { email, username, password }) {
  const passwordHash = await hashPassword(password);

  const result = await pool.query(
    `INSERT INTO users (email, username, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email, username, role, status, created_at`,
    [email, username || null, passwordHash]
  );

  return result.rows[0];
}

/**
 * Находит пользователя по email.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} email — email для поиска
 * @returns {Promise<object|null>} пользователь или null
 */
export async function findUserByEmail(pool, email) {
  const result = await pool.query(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );

  return result.rows[0] ?? null;
}

/**
 * Находит пользователя по ID.
 *
 * @param {import('pg').Pool} pool — пул соединений с PostgreSQL
 * @param {string} userId — UUID пользователя
 * @returns {Promise<object|null>} пользователь (без password_hash)
 */
export async function findUserById(pool, userId) {
  const result = await pool.query(
    `SELECT id, email, username, role, status, last_login_at, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  return result.rows[0] ?? null;
}
