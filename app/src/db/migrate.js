import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
export const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;
export const SCHEMA_MIGRATIONS_TABLE = 'schema_migrations';
const ADVISORY_LOCK_KEY = 4703321001;

/**
 * Читает миграции из каталога и вычисляет контрольные суммы.
 *
 * @param {string} migrationsDir
 * @returns {Promise<Array<{ version: string, name: string, filename: string, sql: string, checksum: string }>>}
 */
export async function listMigrations(migrationsDir = DEFAULT_MIGRATIONS_DIR) {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const match = MIGRATION_FILE_PATTERN.exec(entry.name);
    if (!match) {
      if (entry.name.endsWith('.sql')) {
        throw new Error(`Некорректное имя файла миграции: ${entry.name}`);
      }
      continue;
    }

    const [, version, name] = match;
    const sql = await readFile(path.join(migrationsDir, entry.name), 'utf8');
    migrations.push({
      version,
      name,
      filename: entry.name,
      sql,
      checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
    });
  }

  migrations.sort((left, right) => left.version.localeCompare(right.version));

  const seen = new Set();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`Дублирующаяся версия миграции: ${migration.version}`);
    }
    seen.add(migration.version);
  }

  return migrations;
}

/**
 * Применяет ожидающие миграции. Каждая миграция выполняется в отдельной транзакции.
 *
 * @param {{
 *   pool: import('pg').Pool,
 *   migrationsDir?: string,
 *   logger?: { info: Function, warn: Function },
 * }} options
 */
export async function runMigrations({ pool, migrationsDir = DEFAULT_MIGRATIONS_DIR, logger }) {
  const migrations = await listMigrations(migrationsDir);
  const client = await pool.connect();
  const applied = [];

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await ensureSchemaMigrationsTable(client);

    const existing = await readAppliedMigrations(client);
    const byVersion = new Map(migrations.map((migration) => [migration.version, migration]));

    for (const record of existing) {
      const migration = byVersion.get(record.version);
      if (!migration) {
        throw new Error(
          `Миграция ${record.version}_${record.name} применена, но файла нет в каталоге. ` +
            'Восстановите файл или добавьте компенсирующую миграцию.',
        );
      }
      if (migration.checksum !== record.checksum) {
        throw new Error(
          `Контрольная сумма миграции ${migration.filename} не совпадает с применённой. ` +
            'Изменять применённые миграции запрещено (ADR 0006).',
        );
      }
    }

    const appliedVersions = new Set(existing.map((record) => record.version));

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }

      logger?.info({ migration: migration.filename }, 'применение миграции');
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query(
          `INSERT INTO ${SCHEMA_MIGRATIONS_TABLE} (version, name, checksum) VALUES ($1, $2, $3)`,
          [migration.version, migration.name, migration.checksum],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Миграция ${migration.filename} завершилась ошибкой: ${error.message}`, {
          cause: error,
        });
      }
      applied.push(migration.filename);
    }

    if (applied.length === 0) {
      logger?.info('новых миграций нет');
    }

    return {
      applied,
      skipped: migrations
        .filter((migration) => appliedVersions.has(migration.version))
        .map((migration) => migration.filename),
      total: migrations.length,
    };
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
    } catch {
      // Блокировка освобождается при закрытии соединения.
    }
    client.release();
  }
}

/**
 * Возвращает состояние миграций без их применения.
 *
 * @param {{ pool: import('pg').Pool, migrationsDir?: string }} options
 */
export async function getMigrationStatus({ pool, migrationsDir = DEFAULT_MIGRATIONS_DIR }) {
  const migrations = await listMigrations(migrationsDir);
  const tableExists = await schemaMigrationsTableExists(pool);
  const existing = tableExists ? await readAppliedMigrations(pool) : [];
  const appliedVersions = new Set(existing.map((record) => record.version));

  return {
    tableExists,
    migrations: migrations.map((migration) => ({
      version: migration.version,
      name: migration.name,
      filename: migration.filename,
      applied: appliedVersions.has(migration.version),
    })),
    appliedNotOnDisk: existing.filter(
      (record) => !migrations.some((migration) => migration.version === record.version),
    ),
    pending: migrations.filter((migration) => !appliedVersions.has(migration.version)).length,
  };
}

async function ensureSchemaMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA_MIGRATIONS_TABLE} (
      version text PRIMARY KEY,
      name text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now(),
      checksum char(64) NOT NULL
    )
  `);
}

async function schemaMigrationsTableExists(queryable) {
  const result = await queryable.query(
    'SELECT to_regclass($1) IS NOT NULL AS exists',
    [`public.${SCHEMA_MIGRATIONS_TABLE}`],
  );
  return result.rows[0].exists === true;
}

async function readAppliedMigrations(queryable) {
  const result = await queryable.query(
    `SELECT version, name, checksum FROM ${SCHEMA_MIGRATIONS_TABLE} ORDER BY version`,
  );
  return result.rows.map((row) => ({
    version: row.version,
    name: row.name,
    checksum: String(row.checksum).trim(),
  }));
}
