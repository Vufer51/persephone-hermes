import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  getMigrationStatus,
  listMigrations,
  runMigrations,
} from '../src/db/migrate.js';
import { createPool } from '../src/db/pool.js';
import { EXPECTED_TABLES, verifySchema } from '../src/db/verify-schema.js';

describe('listMigrations', () => {
  it('читает миграции в детерминированном порядке и считает checksum', async () => {
    const migrations = await listMigrations();

    expect(migrations.map((migration) => migration.filename)).toEqual(['0001_initial_schema.sql']);
    expect(migrations[0].version).toBe('0001');
    expect(migrations[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(migrations[0].sql).toContain('CREATE TABLE users');
  });
});

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const databaseName = testDatabaseUrl ? new URL(testDatabaseUrl).pathname : '';
const enabled = testDatabaseUrl ? /_test$/.test(databaseName) : false;

describe.skipIf(!enabled)('migrations against PostgreSQL', () => {
  /** @type {import('pg').Pool} */
  let pool;

  beforeAll(() => {
    pool = createPool({ url: testDatabaseUrl, max: 4, applicationName: 'persephone-test' });
  });

  afterAll(async () => {
    await pool?.end();
  });

  beforeEach(async () => {
    await resetSchema(pool);
    await runMigrations({ pool });
  });

  it('создаёт все таблицы и индексы из docs/DATA_MODEL.md', async () => {
    const result = await verifySchema(pool);

    expect(result.missingTables).toEqual([]);
    expect(result.missingIndexes).toEqual([]);
    expect(result.missingExtensions).toEqual([]);
    expect(result.ok).toBe(true);

    const tables = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    for (const table of EXPECTED_TABLES) {
      expect(tables.rows.map((row) => row.table_name)).toContain(table);
    }
  });

  it('повторный запуск не применяет миграции заново', async () => {
    const result = await runMigrations({ pool });

    expect(result.applied).toEqual([]);
    expect(result.skipped).toEqual(['0001_initial_schema.sql']);
  });

  it('status показывает применённую миграцию', async () => {
    const status = await getMigrationStatus({ pool });

    expect(status.tableExists).toBe(true);
    expect(status.pending).toBe(0);
    expect(status.migrations[0]).toMatchObject({
      version: '0001',
      applied: true,
    });
  });

  it('email уникален без учёта регистра (citext)', async () => {
    await insertUser(pool, 'User@Example.com');

    await expect(insertUser(pool, 'user@example.com')).rejects.toMatchObject({ code: '23505' });
  });

  it('transcode_policy в MVP допускает только source', async () => {
    const userId = await insertUser(pool, 'policy@example.com');

    await expect(
      pool.query(
        "INSERT INTO user_settings (user_id, transcode_policy) VALUES ($1, 'auto')",
        [userId],
      ),
    ).rejects.toMatchObject({ code: '23514' });

    const inserted = await pool.query(
      "INSERT INTO user_settings (user_id, transcode_policy) VALUES ($1, 'source') RETURNING user_id",
      [userId],
    );
    expect(inserted.rowCount).toBe(1);
  });

  it('media_assets запрещает абсолютные пути и выход за пределы хранилища', async () => {
    const { storageRootId, recordingId } = await seedCatalog(pool);

    const base = {
      recordingId,
      storageRootId,
      format: 'flac',
      sizeBytes: 1024,
      sha256: 'a'.repeat(64),
    };

    for (const relativePath of ['/absolute.flac', '../escape.flac', 'disc/../escape.flac']) {
      await expect(
        insertMediaAsset(pool, { ...base, relativePath }),
      ).rejects.toMatchObject({ code: '23514' });
    }

    await insertMediaAsset(pool, { ...base, relativePath: 'artist/album/track.flac' });

    await expect(
      insertMediaAsset(pool, { ...base, relativePath: 'artist/album/track.flac' }),
    ).rejects.toMatchObject({ code: '23505' });

    await expect(
      insertMediaAsset(pool, {
        ...base,
        relativePath: 'artist/album/other.flac',
        sha256: 'not-a-sha',
      }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('не допускает две активные prefetch-задачи для одной записи', async () => {
    const { recordingId } = await seedCatalog(pool);

    const first = await pool.query(
      "INSERT INTO prefetch_jobs (recording_id, status) VALUES ($1, 'pending') RETURNING id",
      [recordingId],
    );

    await expect(
      pool.query("INSERT INTO prefetch_jobs (recording_id, status) VALUES ($1, 'queued')", [
        recordingId,
      ]),
    ).rejects.toMatchObject({ code: '23505' });

    await pool.query("UPDATE prefetch_jobs SET status = 'completed' WHERE id = $1", [
      first.rows[0].id,
    ]);

    const second = await pool.query(
      "INSERT INTO prefetch_jobs (recording_id, status) VALUES ($1, 'pending') RETURNING id",
      [recordingId],
    );
    expect(second.rowCount).toBe(1);
  });

  it('порядок playlist_tracks можно менять в одной транзакции при отложенной проверке', async () => {
    const { recordingId } = await seedCatalog(pool, 'Second');
    const otherRecordingId = await insertRecording(pool, 'Artist', 'Another recording');
    const playlist = await pool.query(
      'INSERT INTO playlists (user_id, name) VALUES ($1, $2) RETURNING id',
      [await insertUser(pool, 'playlist@example.com'), 'Test playlist'],
    );

    const first = await pool.query(
      'INSERT INTO playlist_tracks (playlist_id, recording_id, position) VALUES ($1, $2, 0) RETURNING id',
      [playlist.rows[0].id, recordingId],
    );
    const second = await pool.query(
      'INSERT INTO playlist_tracks (playlist_id, recording_id, position) VALUES ($1, $2, 1) RETURNING id',
      [playlist.rows[0].id, otherRecordingId],
    );

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET CONSTRAINTS playlist_tracks_position_key DEFERRED');
      await client.query('UPDATE playlist_tracks SET position = 1 WHERE id = $1', [
        first.rows[0].id,
      ]);
      await client.query('UPDATE playlist_tracks SET position = 0 WHERE id = $1', [
        second.rows[0].id,
      ]);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const positions = await pool.query(
      'SELECT position FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position',
      [playlist.rows[0].id],
    );
    expect(positions.rows.map((row) => row.position)).toEqual([0, 1]);
  });

  it('триггер обновляет updated_at', async () => {
    const artistId = await insertArtist(pool, 'Trigger Artist');
    await pool.query('SELECT pg_sleep(0.01)');
    await pool.query('UPDATE artists SET name = $2 WHERE id = $1', [artistId, 'Renamed Artist']);

    const row = await pool.query('SELECT created_at, updated_at FROM artists WHERE id = $1', [
      artistId,
    ]);
    expect(new Date(row.rows[0].updated_at).getTime()).toBeGreaterThan(
      new Date(row.rows[0].created_at).getTime(),
    );
  });

  it('обнаруживает изменение уже применённой миграции', async () => {
    await resetSchema(pool);
    const tempDir = await mkdtemp(path.join(tmpdir(), 'persephone-migrations-'));
    const filename = '0001_initial_schema.sql';

    try {
      await cp(path.join(DEFAULT_MIGRATIONS_DIR, filename), path.join(tempDir, filename));
      await runMigrations({ pool, migrationsDir: tempDir });

      await writeFile(path.join(tempDir, filename), '\n-- изменено после применения\n', {
        flag: 'a',
      });

      await expect(runMigrations({ pool, migrationsDir: tempDir })).rejects.toThrow(
        /Контрольная сумма/,
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function resetSchema(pool) {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

async function insertUser(pool, email) {
  const result = await pool.query(
    "INSERT INTO users (email, password_hash) VALUES ($1, 'argon2id-placeholder') RETURNING id",
    [email],
  );
  return result.rows[0].id;
}

async function insertArtist(pool, name) {
  const result = await pool.query('INSERT INTO artists (name) VALUES ($1) RETURNING id', [name]);
  return result.rows[0].id;
}

async function insertRecording(pool, artistName, title) {
  const artistId = await insertArtist(pool, artistName);
  const result = await pool.query(
    'INSERT INTO recordings (artist_id, title) VALUES ($1, $2) RETURNING id',
    [artistId, title],
  );
  return result.rows[0].id;
}

async function seedCatalog(pool, recordingTitle = 'Seed recording') {
  const storage = await pool.query(
    "INSERT INTO storage_roots (name, type, identifier) VALUES ($1, 'local', $2) RETURNING id",
    [`storage-${Math.random().toString(36).slice(2)}`, 'local-music'],
  );
  const recordingId = await insertRecording(pool, 'Seed Artist', recordingTitle);

  return {
    storageRootId: storage.rows[0].id,
    recordingId,
  };
}

async function insertMediaAsset(pool, { recordingId, storageRootId, relativePath, format, sizeBytes, sha256 }) {
  return pool.query(
    `INSERT INTO media_assets (recording_id, storage_root_id, relative_path, format, size_bytes, sha256)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [recordingId, storageRootId, relativePath, format, sizeBytes, sha256],
  );
}
