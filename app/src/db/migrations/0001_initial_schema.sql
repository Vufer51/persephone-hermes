-- 0001_initial_schema.sql
-- Начальная схема Persephone Music согласно docs/DATA_MODEL.md.
-- Миграция forward-only (ADR 0006). Изменения — только новой миграцией.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Пользователи и доступ
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext NOT NULL,
  username varchar(64),
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'active',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_key UNIQUE (email),
  CONSTRAINT users_username_key UNIQUE (username),
  CONSTRAINT users_email_not_blank CHECK (length(btrim(email::text)) > 0),
  CONSTRAINT users_username_not_blank CHECK (username IS NULL OR length(btrim(username)) > 0),
  CONSTRAINT users_password_hash_not_blank CHECK (length(btrim(password_hash)) > 0),
  CONSTRAINT users_role_check CHECK (role IN ('admin', 'user')),
  CONSTRAINT users_status_check CHECK (status IN ('active', 'disabled'))
);

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  preferred_format text,
  max_bitrate_kbps integer,
  transcode_policy text NOT NULL DEFAULT 'source',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_settings_max_bitrate_check CHECK (max_bitrate_kbps IS NULL OR max_bitrate_kbps > 0),
  CONSTRAINT user_settings_transcode_policy_check CHECK (transcode_policy IN ('source')),
  CONSTRAINT user_settings_settings_object_check CHECK (jsonb_typeof(settings) = 'object')
);

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  user_agent text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT user_sessions_token_hash_key UNIQUE (token_hash),
  CONSTRAINT user_sessions_token_hash_not_blank CHECK (length(btrim(token_hash)) > 0)
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_expires_at_idx ON user_sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Хранилища и каталог
-- ---------------------------------------------------------------------------

CREATE TABLE storage_roots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  identifier text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT storage_roots_name_key UNIQUE (name),
  CONSTRAINT storage_roots_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT storage_roots_identifier_not_blank CHECK (length(btrim(identifier)) > 0),
  CONSTRAINT storage_roots_type_check CHECK (type IN ('local', 'nfs', 'smb', 'other')),
  CONSTRAINT storage_roots_status_check CHECK (status IN ('active', 'maintenance', 'disabled'))
);

CREATE TABLE artists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_name text,
  musicbrainz_artist_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT artists_name_not_blank CHECK (length(btrim(name)) > 0),
  CONSTRAINT artists_musicbrainz_artist_id_key UNIQUE (musicbrainz_artist_id)
);

CREATE INDEX artists_name_lower_idx ON artists (lower(name));

CREATE TABLE releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE RESTRICT,
  title text NOT NULL,
  release_type text NOT NULL,
  release_date date,
  musicbrainz_release_id uuid,
  musicbrainz_release_group_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT releases_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT releases_type_check CHECK (release_type IN ('album', 'single', 'ep', 'compilation', 'live', 'other')),
  CONSTRAINT releases_musicbrainz_release_id_key UNIQUE (musicbrainz_release_id)
);

CREATE INDEX releases_artist_id_idx ON releases (artist_id);
CREATE INDEX releases_musicbrainz_release_group_id_idx ON releases (musicbrainz_release_group_id);

CREATE TABLE recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE RESTRICT,
  title text NOT NULL,
  duration_ms integer,
  musicbrainz_recording_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recordings_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT recordings_duration_ms_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT recordings_musicbrainz_recording_id_key UNIQUE (musicbrainz_recording_id)
);

CREATE INDEX recordings_artist_id_idx ON recordings (artist_id);

CREATE TABLE release_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_id uuid NOT NULL REFERENCES releases (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  disc_number smallint NOT NULL DEFAULT 1,
  track_number smallint NOT NULL,
  title_override text,
  duration_ms integer,
  CONSTRAINT release_tracks_position_key UNIQUE (release_id, disc_number, track_number),
  CONSTRAINT release_tracks_disc_number_check CHECK (disc_number > 0),
  CONSTRAINT release_tracks_track_number_check CHECK (track_number > 0),
  CONSTRAINT release_tracks_duration_ms_check CHECK (duration_ms IS NULL OR duration_ms >= 0)
);

CREATE INDEX release_tracks_recording_id_idx ON release_tracks (recording_id);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  storage_root_id uuid NOT NULL REFERENCES storage_roots (id) ON DELETE RESTRICT,
  relative_path text NOT NULL,
  format varchar(16) NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 char(64) NOT NULL,
  bitrate_kbps integer,
  sample_rate_hz integer,
  channels smallint,
  duration_ms integer,
  status text NOT NULL DEFAULT 'available',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_storage_path_key UNIQUE (storage_root_id, relative_path),
  CONSTRAINT media_assets_relative_path_check CHECK (
    length(btrim(relative_path)) > 0
    AND relative_path !~ '^/'
    AND relative_path !~ '(^|/)\.\.(/|$)'
  ),
  CONSTRAINT media_assets_format_not_blank CHECK (length(btrim(format)) > 0),
  CONSTRAINT media_assets_size_bytes_check CHECK (size_bytes > 0),
  CONSTRAINT media_assets_sha256_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT media_assets_bitrate_kbps_check CHECK (bitrate_kbps IS NULL OR bitrate_kbps > 0),
  CONSTRAINT media_assets_sample_rate_hz_check CHECK (sample_rate_hz IS NULL OR sample_rate_hz > 0),
  CONSTRAINT media_assets_channels_check CHECK (channels IS NULL OR channels > 0),
  CONSTRAINT media_assets_duration_ms_check CHECK (duration_ms IS NULL OR duration_ms >= 0),
  CONSTRAINT media_assets_status_check CHECK (status IN ('available', 'missing', 'quarantined'))
);

CREATE INDEX media_assets_sha256_size_idx ON media_assets (sha256, size_bytes);
CREATE INDEX media_assets_recording_id_idx ON media_assets (recording_id);

-- ---------------------------------------------------------------------------
-- Интеграции
-- ---------------------------------------------------------------------------

CREATE TABLE user_lastfm (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  lastfm_username text NOT NULL,
  session_key_encrypted bytea NOT NULL,
  encryption_key_version smallint NOT NULL DEFAULT 1,
  status text NOT NULL,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_lastfm_username_not_blank CHECK (length(btrim(lastfm_username)) > 0),
  CONSTRAINT user_lastfm_session_key_not_empty CHECK (length(session_key_encrypted) > 0),
  CONSTRAINT user_lastfm_key_version_check CHECK (encryption_key_version > 0),
  CONSTRAINT user_lastfm_status_check CHECK (status IN ('connected', 'error', 'disconnected'))
);

CREATE INDEX user_lastfm_username_idx ON user_lastfm (lastfm_username);

CREATE TABLE external_recommendation_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  entity_type text NOT NULL,
  external_id text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CONSTRAINT external_recommendation_cache_key UNIQUE (source, entity_type, external_id),
  CONSTRAINT external_recommendation_cache_source_check CHECK (source IN ('lastfm', 'musicbrainz')),
  CONSTRAINT external_recommendation_cache_entity_type_check CHECK (entity_type IN ('artist', 'recording', 'release')),
  CONSTRAINT external_recommendation_cache_external_id_not_blank CHECK (length(btrim(external_id)) > 0),
  CONSTRAINT external_recommendation_cache_expires_check CHECK (expires_at > fetched_at)
);

CREATE INDEX external_recommendation_cache_expires_at_idx ON external_recommendation_cache (expires_at);

-- ---------------------------------------------------------------------------
-- История и предпочтения
-- ---------------------------------------------------------------------------

CREATE TABLE playback_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  media_asset_id uuid REFERENCES media_assets (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  start_position_ms integer NOT NULL DEFAULT 0,
  end_position_ms integer,
  listened_ms integer,
  completed boolean NOT NULL DEFAULT false,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playback_sessions_start_position_check CHECK (start_position_ms >= 0),
  CONSTRAINT playback_sessions_end_position_check CHECK (end_position_ms IS NULL OR end_position_ms >= 0),
  CONSTRAINT playback_sessions_listened_ms_check CHECK (listened_ms IS NULL OR listened_ms >= 0),
  CONSTRAINT playback_sessions_time_order_check CHECK (ended_at IS NULL OR ended_at >= started_at),
  CONSTRAINT playback_sessions_source_check CHECK (source IN ('web', 'subsonic', 'api'))
);

CREATE INDEX playback_sessions_user_started_idx ON playback_sessions (user_id, started_at DESC);
CREATE INDEX playback_sessions_recording_id_idx ON playback_sessions (recording_id);
CREATE INDEX playback_sessions_media_asset_id_idx ON playback_sessions (media_asset_id);

CREATE TABLE scrobbles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  playback_session_id uuid REFERENCES playback_sessions (id) ON DELETE SET NULL,
  played_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scrobbles_unique_play_key UNIQUE (user_id, recording_id, played_at),
  CONSTRAINT scrobbles_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  CONSTRAINT scrobbles_attempt_count_check CHECK (attempt_count >= 0)
);

CREATE INDEX scrobbles_status_last_attempt_idx ON scrobbles (status, last_attempt_at);
CREATE INDEX scrobbles_recording_id_idx ON scrobbles (recording_id);
CREATE INDEX scrobbles_playback_session_id_idx ON scrobbles (playback_session_id);

CREATE TABLE user_track_preferences (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  affinity_score numeric(6, 3) NOT NULL DEFAULT 0,
  play_count integer NOT NULL DEFAULT 0,
  skip_count integer NOT NULL DEFAULT 0,
  last_played_at timestamptz,
  last_skipped_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id),
  CONSTRAINT user_track_preferences_counts_check CHECK (play_count >= 0 AND skip_count >= 0)
);

CREATE INDEX user_track_preferences_affinity_idx ON user_track_preferences (user_id, affinity_score DESC);
CREATE INDEX user_track_preferences_recording_id_idx ON user_track_preferences (recording_id);

CREATE TABLE user_artist_preferences (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  artist_id uuid NOT NULL REFERENCES artists (id) ON DELETE CASCADE,
  affinity_score numeric(6, 3) NOT NULL DEFAULT 0,
  play_count integer NOT NULL DEFAULT 0,
  skip_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, artist_id),
  CONSTRAINT user_artist_preferences_counts_check CHECK (play_count >= 0 AND skip_count >= 0)
);

CREATE INDEX user_artist_preferences_affinity_idx ON user_artist_preferences (user_id, affinity_score DESC);
CREATE INDEX user_artist_preferences_artist_id_idx ON user_artist_preferences (artist_id);

CREATE TABLE user_likes (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, recording_id)
);

CREATE INDEX user_likes_recording_id_idx ON user_likes (recording_id);

CREATE TABLE user_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  playback_session_id uuid REFERENCES playback_sessions (id) ON DELETE SET NULL,
  skipped_at timestamptz NOT NULL,
  position_ms integer,
  CONSTRAINT user_skips_position_ms_check CHECK (position_ms IS NULL OR position_ms >= 0)
);

CREATE INDEX user_skips_user_skipped_idx ON user_skips (user_id, skipped_at DESC);
CREATE INDEX user_skips_recording_id_idx ON user_skips (recording_id);
CREATE INDEX user_skips_playback_session_id_idx ON user_skips (playback_session_id);

-- ---------------------------------------------------------------------------
-- Плейлисты и очередь
-- ---------------------------------------------------------------------------

CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name varchar(255) NOT NULL,
  description text,
  is_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playlists_user_name_key UNIQUE (user_id, name),
  CONSTRAINT playlists_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE playlist_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  playlist_id uuid NOT NULL REFERENCES playlists (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  position integer NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playlist_tracks_position_key UNIQUE (playlist_id, position) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT playlist_tracks_position_check CHECK (position >= 0)
);

CREATE INDEX playlist_tracks_recording_id_idx ON playlist_tracks (recording_id);

CREATE TABLE playback_queues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name varchar(64) NOT NULL DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playback_queues_user_name_key UNIQUE (user_id, name),
  CONSTRAINT playback_queues_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE TABLE playback_queue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id uuid NOT NULL REFERENCES playback_queues (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  position integer NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT playback_queue_items_position_key UNIQUE (queue_id, position) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT playback_queue_items_position_check CHECK (position >= 0)
);

CREATE INDEX playback_queue_items_recording_id_idx ON playback_queue_items (recording_id);

-- ---------------------------------------------------------------------------
-- Рекомендации
-- ---------------------------------------------------------------------------

CREATE TABLE recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE CASCADE,
  batch_id uuid NOT NULL,
  score numeric(8, 5) NOT NULL,
  reason_code text NOT NULL,
  reason_text text,
  source text,
  status text NOT NULL DEFAULT 'active',
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  CONSTRAINT recommendations_unique_batch_key UNIQUE (user_id, recording_id, batch_id),
  CONSTRAINT recommendations_reason_code_check CHECK (
    reason_code IN ('similar_artist', 'favorite_artist', 'recent_album', 'lastfm', 'genre', 'rediscover', 'radio')
  ),
  CONSTRAINT recommendations_status_check CHECK (status IN ('active', 'dismissed', 'played', 'expired')),
  CONSTRAINT recommendations_expires_check CHECK (expires_at IS NULL OR expires_at > generated_at)
);

CREATE INDEX recommendations_user_status_score_idx ON recommendations (user_id, status, score DESC);
CREATE INDEX recommendations_expires_at_idx ON recommendations (expires_at);
CREATE INDEX recommendations_recording_id_idx ON recommendations (recording_id);

-- ---------------------------------------------------------------------------
-- Prefetch
-- ---------------------------------------------------------------------------

CREATE TABLE prefetch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recording_id uuid NOT NULL REFERENCES recordings (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending',
  priority integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT prefetch_jobs_status_check CHECK (
    status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')
  ),
  CONSTRAINT prefetch_jobs_attempt_count_check CHECK (attempt_count >= 0),
  CONSTRAINT prefetch_jobs_max_attempts_check CHECK (max_attempts > 0),
  CONSTRAINT prefetch_jobs_attempts_check CHECK (attempt_count <= max_attempts)
);

CREATE UNIQUE INDEX prefetch_jobs_active_recording_idx
  ON prefetch_jobs (recording_id)
  WHERE status IN ('pending', 'queued', 'running');

CREATE INDEX prefetch_jobs_status_priority_created_idx
  ON prefetch_jobs (status, priority DESC, created_at);

CREATE TABLE prefetch_job_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES prefetch_jobs (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason text NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT prefetch_job_requests_unique_key UNIQUE (job_id, user_id, reason),
  CONSTRAINT prefetch_job_requests_reason_check CHECK (reason IN ('radio', 'playlist', 'recommendation', 'manual'))
);

CREATE INDEX prefetch_job_requests_user_id_idx ON prefetch_job_requests (user_id);

-- ---------------------------------------------------------------------------
-- Триггеры updated_at
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users',
    'user_settings',
    'storage_roots',
    'artists',
    'releases',
    'recordings',
    'media_assets',
    'user_lastfm',
    'user_track_preferences',
    'user_artist_preferences',
    'playlists',
    'playback_queues',
    'prefetch_jobs'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name,
      table_name
    );
  END LOOP;
END;
$$;
