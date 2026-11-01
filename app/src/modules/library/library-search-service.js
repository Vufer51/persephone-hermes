

/**
 * Ищет в библиотеке по ключевому слову.
 *
 * @param {import('pg').Pool} pool
 * @param {string} q - поисковый запрос
 * @param {number} [limit=20]
 * @param {number} [offset=0]
 * @returns {Promise<{ artists: Array, recordings: Array, releases: Array, media_assets: Array, total: number }>}
 */
export async function searchLibrary(pool, q, limit, offset) {
  const searchPattern = `%${q}%`;

  const artistsResult = await pool.query(
    `SELECT id, name FROM artists WHERE lower(name) LIKE lower($1)
     LIMIT $2 OFFSET $3`,
    [searchPattern, limit, offset],
  );

  const recordingsResult = await pool.query(
    `SELECT r.id, r.title, r.duration_ms, a.name AS artist_name
     FROM recordings r
     LEFT JOIN artists a ON r.artist_id = a.id
     WHERE lower(r.title) LIKE lower($1)
     LIMIT $2 OFFSET $3`,
    [searchPattern, limit, offset],
  );

  const releasesResult = await pool.query(
    `SELECT re.id, re.title, re.release_type, re.release_date, a.name AS artist_name
     FROM releases re
     LEFT JOIN artists a ON re.artist_id = a.id
     WHERE lower(re.title) LIKE lower($1)
     LIMIT $2 OFFSET $3`,
    [searchPattern, limit, offset],
  );

  const mediaAssetsCount = await pool.query(
    `SELECT COUNT(*)::int AS total FROM media_assets ma
     JOIN recordings r ON ma.recording_id = r.id
     WHERE r.title ILIKE $1
       AND ma.status = 'available'`,
    [searchPattern],
  );

  const mediaAssetsResult = await pool.query(
    `SELECT ma.id, ma.relative_path, ma.format, ma.size_bytes,
            ma.bitrate_kbps, ma.sample_rate_hz, ma.channels, ma.duration_ms,
            r.id AS recording_id, r.title AS recording_title,
            a.name AS artist_name
     FROM media_assets ma
     JOIN recordings r ON ma.recording_id = r.id
     LEFT JOIN artists a ON r.artist_id = a.id
     WHERE r.title ILIKE $1
       AND ma.status = 'available'
     LIMIT $2 OFFSET $3`,
    [searchPattern, limit, offset],
  );

  return {
    artists: artistsResult.rows,
    recordings: recordingsResult.rows,
    releases: releasesResult.rows,
    media_assets: mediaAssetsResult.rows,
    total: parseInt(mediaAssetsCount.rows[0]?.total ?? '0', 10),
  };
}

/**
 * Возвращает список артистов с пагинацией.
 *
 * @param {import('pg').Pool} pool
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{ artists: Array, total: number }>}
 */
export async function listArtists(pool, limit, offset) {
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM artists`,
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const artistsResult = await pool.query(
    `SELECT id, name, sort_name, created_at
     FROM artists
     ORDER BY name
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return {
    artists: artistsResult.rows,
    total,
  };
}

/**
 * Возвращает детальную информацию об артисте.
 *
 * @param {import('pg').Pool} pool
 * @param {string} artistId
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{ artist: object|null, recordings: Array, total: number }>}
 */
export async function getArtist(pool, artistId, limit, offset) {
  const artistResult = await pool.query(
    `SELECT id, name, sort_name, musicbrainz_artist_id, created_at, updated_at
     FROM artists WHERE id = $1`,
    [artistId],
  );

  if (artistResult.rows.length === 0) {
    return { artist: null, recordings: [], total: 0 };
  }

  const artist = artistResult.rows[0];

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM recordings WHERE artist_id = $1`,
    [artistId],
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const recordingsResult = await pool.query(
    `SELECT id, title, duration_ms, musicbrainz_recording_id, created_at
     FROM recordings
     WHERE artist_id = $1
     ORDER BY title
     LIMIT $2 OFFSET $3`,
    [artistId, limit, offset],
  );

  return { artist, recordings: recordingsResult.rows, total };
}

/**
 * Возвращает детальную информацию о записи.
 *
 * @param {import('pg').Pool} pool
 * @param {string} recordingId
 * @returns {Promise<{ recording: object|null, media_assets: Array }>}
 */
export async function getRecording(pool, recordingId) {
  const recordingResult = await pool.query(
    `SELECT r.id, r.title, r.duration_ms, r.musicbrainz_recording_id, r.created_at,
            a.id AS artist_id, a.name AS artist_name
     FROM recordings r
     LEFT JOIN artists a ON r.artist_id = a.id
     WHERE r.id = $1`,
    [recordingId],
  );

  if (recordingResult.rows.length === 0) {
    return { recording: null, media_assets: [] };
  }

  const recording = recordingResult.rows[0];

  const assetsResult = await pool.query(
    `SELECT id, relative_path, format, size_bytes, sha256,
            bitrate_kbps, sample_rate_hz, channels, duration_ms, status
     FROM media_assets
     WHERE recording_id = $1 AND status = 'available'
     ORDER BY relative_path`,
    [recordingId],
  );

  return { recording, media_assets: assetsResult.rows };
}

/**
 * Возвращает список релизов с пагинацией.
 *
 * @param {import('pg').Pool} pool
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{ releases: Array, total: number }>}
 */
export async function listReleases(pool, limit, offset) {
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM releases`,
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const releasesResult = await pool.query(
    `SELECT re.id, re.title, re.release_type, re.release_date,
            a.name AS artist_name
     FROM releases re
     LEFT JOIN artists a ON re.artist_id = a.id
     ORDER BY re.release_date DESC, re.title
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return { releases: releasesResult.rows, total };
}

/**
 * Возвращает список записей с пагинацией.
 *
 * @param {import('pg').Pool} pool
 * @param {number} limit
 * @param {number} offset
 * @returns {Promise<{ recordings: Array, total: number }>}
 */
export async function listRecordings(pool, limit, offset) {
  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS total FROM recordings`,
  );
  const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

  const recordingsResult = await pool.query(
    `SELECT r.id, r.title, r.duration_ms,
            a.name AS artist_name, a.id AS artist_id
     FROM recordings r
     LEFT JOIN artists a ON r.artist_id = a.id
     ORDER BY r.title
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return { recordings: recordingsResult.rows, total };
}
