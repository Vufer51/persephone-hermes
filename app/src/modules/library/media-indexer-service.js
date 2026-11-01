import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { join, extname } from 'node:path';
import { parseFile } from 'music-metadata';
import { pipeline } from 'node:stream/promises';

/**
 * Допустимые аудио-расширения для индексирования.
 */
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a',
  '.wma', '.opus', '.webm', '.aiff', '.ape',
]);

/**
 * Сканирует директорию хранилища рекурсивно, собирая списки аудиофайлов.
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @param {string} identifier - путь к корню хранилища
 * @returns {Promise<Array<{ relativePath: string, fullPath: string, sizeBytes: number }>>}
 */
async function scanStorageRoot(pool, storageRootId, identifier) {
  const results = [];

  async function walk(dir) {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (AUDIO_EXTENSIONS.has(ext)) {
            try {
              const stats = await fs.stat(fullPath);
              const relativePath = fullPath.slice(identifier.length).replace(/^[\\/\\]/, '').replace(/\\/g, '/');
              if (relativePath.length > 0) {
                results.push({ relativePath, fullPath, sizeBytes: stats.size });
              }
            } catch (_err) {
              // Пропускаем файлы, к которым нет доступа
            }
          }
        }
      }
    } catch {
      // Пропускаем недоступные директории
    }
  }

  await walk(identifier);
  return results;
}

/**
 * Вычисляет SHA256 хеш файла.
 *
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function computeSha256(filePath) {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');

  try {
    const readStream = createReadStream(filePath);
    await pipeline(readStream, hash);
  } catch (_err) {
    throw Object.assign(new Error(`Не удалось прочитать файл: ${filePath}`), { code: 'FILE_READ_ERROR' });
  }

  return hash.digest('hex');
}

/**
 * Извлекает метаданные аудиофайла через music-metadata.
 *
 * @param {string} filePath
 * @returns {Promise<{ title: string|null, durationMs: number|null, bitrateKbps: number|null, sampleRateHnz: number|null, channels: number|null, format: string }>}
 */
async function extractMetadata(filePath) {
  try {
    const metadata = await parseFile(filePath, { size: 50 * 1024 * 1024 });

    const format = metadata.format?.container || extname(filePath).replace('.', '').toLowerCase();
    const durationMs = metadata.format?.duration
      ? Math.round(metadata.format.duration * 1000)
      : null;
    const bitrateKbps = metadata.format?.bitrate
      ? Math.round(metadata.format.bitrate / 1000)
      : null;
    const sampleRateHnz = metadata.format?.sampleRate ?? null;
    const channels = metadata.format?.numberOfChannels ?? null;

    const title = metadata.common?.title ?? null;

    return { title, durationMs, bitrateKbps, sampleRateHnz, channels, format };
  } catch (_err) {
    // Если music-metadata не смог распознать файл, возвращаем базовые данные
    const format = extname(filePath).replace('.', '').toLowerCase();
    return { title: null, durationMs: null, bitrateKbps: null, sampleRateHnz: null, channels: null, format };
  }
}

/**
 * Находит или создаёт артиста по имени.
 *
 * @param {import('pg').Pool} pool
 * @param {string} name
 * @returns {Promise<{ id: string, name: string }>}
 */
async function ensureArtist(pool, name) {
  const result = await pool.query(
    'INSERT INTO artists (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING id, name',
    [randomUUID(), name],
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const existing = await pool.query(
    'SELECT id, name FROM artists WHERE lower(name) = lower($1) LIMIT 1',
    [name],
  );
  return existing.rows[0] ?? { id: randomUUID(), name };
}

/**
 * Находит или создаёт запись по названию и артисту.
 *
 * @param {import('pg').Pool} pool
 * @param {string} artistId
 * @param {string} title
 * @param {number|null} durationMs
 * @returns {Promise<{ id: string, artist_id: string, title: string, duration_ms: number|null }>}
 */
async function ensureRecording(pool, artistId, title, durationMs) {
  const result = await pool.query(
    `INSERT INTO recordings (id, artist_id, title, duration_ms)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (musicbrainz_recording_id) DO NOTHING
     RETURNING id, artist_id, title, duration_ms`,
    [randomUUID(), artistId, title, durationMs],
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  const existing = await pool.query(
    `SELECT id, artist_id, title, duration_ms FROM recordings
     WHERE artist_id = $1 AND lower(title) = lower($2) AND duration_ms = $3
     LIMIT 1`,
    [artistId, title, durationMs],
  );
  return existing.rows[0] ?? { id: randomUUID(), artist_id: artistId, title, duration_ms: durationMs };
}

/**
 * Запускает индексирование хранилища: сканирует файлы, извлекает метаданные,
 * создаёт записи и медиа-ассеты в БД.
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @param {string} identifier - путь к корню хранилища
 * @returns {Promise<{ scanned: number, created: number, skipped: number }>}
 */
export async function indexStorageRoot(pool, storageRootId, identifier) {
  const files = await scanStorageRoot(pool, storageRootId, identifier);

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    // Проверяем, не существует ли уже медиа-ассет
    const existing = await pool.query(
      'SELECT id FROM media_assets WHERE storage_root_id = $1 AND relative_path = $2',
      [storageRootId, file.relativePath],
    );
    if (existing.rows.length > 0) {
      skipped++;
      continue;
    }

    let sha256;
    try {
      sha256 = await computeSha256(file.fullPath);
    } catch {
      skipped++;
      continue;
    }

    // Проверяем дедупликацию по хешу
    const dedup = await pool.query(
      'SELECT id FROM media_assets WHERE sha256 = $1 AND size_bytes = $2',
      [sha256, file.sizeBytes],
    );
    if (dedup.rows.length > 0) {
      // Файл уже есть с таким же хешем и размером — пропускаем
      skipped++;
      continue;
    }

    const metadata = await extractMetadata(file.fullPath);

    // Находим или создаём артиста
    const artistName = metadata.title ? metadata.title.split(' - ')[0]?.trim() : 'Unknown Artist';
    const artist = await ensureArtist(pool, artistName);

    // Находим или создаём запись
    const recordingTitle = metadata.title || file.relativePath.split('/').pop().split('.')[0] || 'Unknown Track';
    const recording = await ensureRecording(pool, artist.id, recordingTitle, metadata.durationMs);

    // Создаём медиа-ассет
    await pool.query(
      `INSERT INTO media_assets (id, recording_id, storage_root_id, relative_path, format, size_bytes, sha256, bitrate_kbps, sample_rate_hz, channels, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        randomUUID(),
        recording.id,
        storageRootId,
        file.relativePath,
        metadata.format,
        file.sizeBytes,
        sha256,
        metadata.bitrateKbps,
        metadata.sampleRateHnz,
        metadata.channels,
        metadata.durationMs,
      ],
    );

    created++;
  }

  return { scanned: files.length, created, skipped };
}

/**
 * Останавливает индексирование хранилища (резервный API).
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @returns {Promise<boolean>}
 */
export async function stopIndexing(pool, storageRootId) {
  return await pool.query(
    "UPDATE storage_roots SET status = 'active' WHERE id = $1 AND status = 'maintenance'",
    [storageRootId],
  ).then((r) => r.rowCount > 0);
}

/**
 * Проверяет, индексируется ли хранилище.
 *
 * @param {import('pg').Pool} pool
 * @param {string} storageRootId
 * @returns {Promise<'indexing' | 'active' | 'maintenance' | 'disabled' | null>}
 */
export async function getIndexingStatus(pool, storageRootId) {
  const result = await pool.query(
    "SELECT status FROM storage_roots WHERE id = $1",
    [storageRootId],
  );
  return result.rows[0]?.status ?? null;
}
