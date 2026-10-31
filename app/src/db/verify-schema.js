export const EXPECTED_TABLES = [
  'users',
  'user_settings',
  'user_sessions',
  'storage_roots',
  'artists',
  'releases',
  'recordings',
  'release_tracks',
  'media_assets',
  'user_lastfm',
  'external_recommendation_cache',
  'playback_sessions',
  'scrobbles',
  'user_track_preferences',
  'user_artist_preferences',
  'user_likes',
  'user_skips',
  'playlists',
  'playlist_tracks',
  'playback_queues',
  'playback_queue_items',
  'recommendations',
  'prefetch_jobs',
  'prefetch_job_requests',
];

export const EXPECTED_EXTENSIONS = ['pgcrypto', 'citext'];

export const EXPECTED_INDEXES = [
  'user_sessions_user_id_idx',
  'user_sessions_expires_at_idx',
  'artists_name_lower_idx',
  'releases_artist_id_idx',
  'releases_musicbrainz_release_group_id_idx',
  'recordings_artist_id_idx',
  'release_tracks_recording_id_idx',
  'media_assets_sha256_size_idx',
  'media_assets_recording_id_idx',
  'user_lastfm_username_idx',
  'external_recommendation_cache_expires_at_idx',
  'playback_sessions_user_started_idx',
  'scrobbles_status_last_attempt_idx',
  'user_track_preferences_affinity_idx',
  'user_artist_preferences_affinity_idx',
  'user_likes_recording_id_idx',
  'user_skips_user_skipped_idx',
  'playlist_tracks_recording_id_idx',
  'playback_queue_items_recording_id_idx',
  'recommendations_user_status_score_idx',
  'recommendations_expires_at_idx',
  'prefetch_jobs_active_recording_idx',
  'prefetch_jobs_status_priority_created_idx',
  'prefetch_job_requests_user_id_idx',
];

/**
 * Проверяет, что миграции создали ожидаемую схему.
 *
 * @param {import('pg').Pool | import('pg').PoolClient} queryable
 */
export async function verifySchema(queryable) {
  const tablesResult = await queryable.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  `);
  const actualTables = tablesResult.rows.map((row) => row.table_name);
  const expectedTables = [...EXPECTED_TABLES, 'schema_migrations'];

  const missingTables = expectedTables.filter((table) => !actualTables.includes(table));
  const unexpectedTables = actualTables.filter((table) => !expectedTables.includes(table));

  const extensionsResult = await queryable.query('SELECT extname FROM pg_extension');
  const actualExtensions = extensionsResult.rows.map((row) => row.extname);
  const missingExtensions = EXPECTED_EXTENSIONS.filter(
    (extension) => !actualExtensions.includes(extension),
  );

  const indexesResult = await queryable.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
  `);
  const actualIndexes = indexesResult.rows.map((row) => row.indexname);
  const missingIndexes = EXPECTED_INDEXES.filter((index) => !actualIndexes.includes(index));

  return {
    ok:
      missingTables.length === 0 &&
      missingExtensions.length === 0 &&
      missingIndexes.length === 0,
    missingTables,
    unexpectedTables,
    missingExtensions,
    missingIndexes,
  };
}
