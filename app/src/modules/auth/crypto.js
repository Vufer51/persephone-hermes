import argon2 from 'argon2';
import crypto from 'node:crypto';

/**
 * Хеширует пароль с использованием Argon2id.
 *
 * @param {string} password — пароль для хеширования
 * @returns {Promise<string>} хеш пароля
 */
export async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

/**
 * Проверяет пароль с ранее сохранённым хешем.
 *
 * @param {string} password — пароль для проверки
 * @param {string} hash — сохранённый хеш
 * @returns {Promise<boolean>} true, если пароль совпадает
 */
export async function verifyPassword(password, hash) {
  return argon2.verify(hash, password);
}

/**
 * Генерирует криптографически стойкий токен (32 байта, base64).
 *
 * @returns {string} токен
 */
export function generateToken() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * Хеширует токен для хранения в базе данных.
 * Используется SHA-256, так как мы проверяем равенство, а не ищем по токену.
 *
 * @param {string} token — исходный токен
 * @returns {string} хеш токена (hex)
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Генерирует уникальный идентификатор сессии.
 *
 * @returns {string} UUID
 */
export function generateSessionId() {
  return crypto.randomUUID();
}
