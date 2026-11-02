-- ---------------------------------------------------------------------------
-- Таблица запросов на скачивание (integration с Lidarr)
-- Пользователь может запросить скачивание исполнителя/трека через наше приложение.
-- Lidarr скачивает альбомы исполнителя через настроенный загрузчик (qBittorrent)
-- и импортирует их в библиотеку, откуда Navidrome и Persephone подхватывают файлы.
-- ---------------------------------------------------------------------------

CREATE TABLE download_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  recording_id uuid REFERENCES recordings (id) ON DELETE SET NULL,
  artist_name varchar(256) NOT NULL,
  artist_mb_id varchar(36), -- MusicBrainz ID исполнителя
  lidarr_artist_id integer, -- ID исполнителя в Lidarr
  status text NOT NULL DEFAULT 'pending',
  -- pending: запрошен, sending: отправлен в Lidarr, downloading: скачивается,
  -- completed: импортировано в библиотеку, failed: ошибка, cancelled: отменено
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT download_requests_status_check
    CHECK (status IN ('pending', 'sending', 'downloading', 'completed', 'failed', 'cancelled')),
  CONSTRAINT download_requests_user_recording_unique
    UNIQUE (user_id, recording_id)
);

CREATE INDEX download_requests_user_id_idx ON download_requests (user_id);
CREATE INDEX download_requests_status_idx ON download_requests (status);
CREATE INDEX download_requests_created_at_idx ON download_requests (created_at);

-- Триггер updated_at
DO $$
DECLARE
  table_name text := 'download_requests';
BEGIN
  EXECUTE format(
    'CREATE TRIGGER %I_set_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
    table_name,
    table_name
  );
END $$;