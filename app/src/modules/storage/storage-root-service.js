import { randomUUID } from 'node:crypto';

/**
 * Допустимые типы хранилищ.
 */
export const STORAGE_ROOT_TYPES = ['local', 'nfs', 'smb', 'other'];

/**
 * Допустимые статусы хранилищ.
 */
export const STORAGE_ROOT_STATUSES = ['active', 'maintenance', 'disabled'];

/**
 * Создает запись хранилища в БД.
 *
 * @param {import('pg').Pool} pool
 * @param {{ name: string; type: string; identifier: string }} data
 * @returns {Promise<{ id: string; name: string; type: string; identifier: string; status: string; createdAt: string }>}
 */
export async function createStorageRoot(pool, { name, type, identifier }) {
  const id = randomUUID();
  const now = new Date().toISOString();

  const result = await pool.query(
    `INSERT INTO storage_roots (id, name, type, identifier, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'active', $5, $5)
     RETURNING id, name, type, identifier, status, created_at AS "createdAt"`,
    [id, name, type, identifier, now]
  );

  return result.rows[0];
}

/**
 * Находит хранилище по id.
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @returns {Promise<{ id: string; name: string; type: string; identifier: string; status: string; createdAt: string; updatedAt: string } | null>}
 */
export async function findStorageRootById(pool, storageRootId) {
  const result = await pool.query(
    `SELECT id, name, type, identifier, status, created_at AS "createdAt", updated_at AS "updatedAt"
     FROM storage_roots
     WHERE id = $1`,
    [storageRootId]
  );

  return result.rows[0] ?? null;
}

/**
 * Находит хранилище по имени.
 *
 * @param {import('pg').Pool} pool
 * @param {string} name
 * @returns {Promise<{ id: string; name: string; type: string; identifier: string; status: string } | null>}
 */
export async function findStorageRootByName(pool, name) {
  const result = await pool.query(
    `SELECT id, name, type, identifier, status
     FROM storage_roots
     WHERE name = $1`,
    [name]
  );

  return result.rows[0] ?? null;
}

/**
 * Получает список хранилищ с опциональной фильтрацией по статусу.
 *
 * @param {import('pg').Pool} pool
 * @param {object} [options]
 * @param {'active'|'maintenance'|'disabled'} [options.status]
 * @returns {Promise<Array<{ id: string; name: string; type: string; identifier: string; status: string; createdAt: string }>>}
 */
export async function listStorageRoots(pool, options = {}) {
  const { status } = options;

  if (status) {
    const result = await pool.query(
      `SELECT id, name, type, identifier, status, created_at AS "createdAt"
       FROM storage_roots
       WHERE status = $1
       ORDER BY name`,
      [status]
    );
    return result.rows;
  }

  const result = await pool.query(
    `SELECT id, name, type, identifier, status, created_at AS "createdAt"
     FROM storage_roots
     ORDER BY name`
  );
  return result.rows;
}

/**
 * Обновляет статус хранилища.
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @param {string} status
 * @returns {Promise<{ id: string; name: string; type: string; identifier: string; status: string } | null>}
 */
export async function updateStorageRootStatus(pool, storageRootId, status) {
  const result = await pool.query(
    `UPDATE storage_roots
     SET status = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name, type, identifier, status`,
    [storageRootId, status]
  );

  return result.rows[0] ?? null;
}

/**
 * Удаляет хранилище (soft delete через status='disabled').
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @returns {Promise<boolean>} true если найдено и удалено
 */
export async function deleteStorageRoot(pool, storageRootId) {
  const result = await pool.query(
    `UPDATE storage_roots
     SET status = 'disabled', updated_at = NOW()
     WHERE id = $1 AND status != 'disabled'
     RETURNING id`,
    [storageRootId]
  );

  return result.rows.length > 0;
}
