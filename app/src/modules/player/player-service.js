/**
 * Сервис Web Player — управление воспроизведением через веб-интерфейс.
 * Поддерживает HTML5 аудио плеер, стриминг, историю и текущий трек.
 */
export class PlayerService {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {import('./navidrome-client.js').NavidromeClient} [deps.navidromeClient]
   */
  constructor({ pool, config, navidromeClient = null }) {
    this.pool = pool;
    this.config = config;
    this.navidromeClient = navidromeClient;
  }

  /**
   * Получает URL стрима для медиа-ассета (для HTML5 аудио плеера).
   * @param {string} mediaAssetId
   * @param {Object} [options={}]
   * @param {number} [options.timeOffset] - смещение в секундах
   * @returns {Promise<string>} URL для стриминга
   */
  async getStreamUrl(mediaAssetId, options = {}) {
    // Получаем информацию о медиа-ассете
    const assetResult = await this.pool.query(
      `SELECT ma.*, r.title, a.name AS artist_name
       FROM media_assets ma
       JOIN recordings r ON ma.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ma.id = $1`,
      [mediaAssetId],
    );

    if (assetResult.rows.length === 0) {
      throw new Error('Media asset not found');
    }

    const asset = assetResult.rows[0];

    if (this.navidromeClient) {
      // Ищем трек в Navidrome по названию и исполнителю
      const navidromeSong = await this._findInNavidrome(asset.title, asset.artist_name);
      if (!navidromeSong) {
        throw new Error('Track not found in Navidrome');
      }

      return this.navidromeClient.getStreamUrl(navidromeSong.id, {
        timeOffset: options.timeOffset,
      });
    }

    // Если нет Navidrome — возвращаем локальный путь для прямого доступа
    return `/api/v1/library/assets/${mediaAssetId}/stream`;
  }

  /**
   * Получает текущее воспроизведение (Now Playing) для веб-плеера.
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getNowPlaying(userId) {
    const sessionResult = await this.pool.query(
      `SELECT * FROM playback_sessions
       WHERE user_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [userId],
    );

    if (sessionResult.rows.length === 0) { return null; }

    const session = sessionResult.rows[0];

    // Получаем полную информацию о треке
    const trackResult = await this.pool.query(
      `SELECT
         r.id AS recording_id, r.title AS recording_title,
         r.duration_ms AS recording_duration,
         a.id AS artist_id, a.name AS artist_name,
         ma.id AS media_asset_id,
         ps.started_at, ps.start_position_ms, ps.end_position_ms, ps.listened_ms
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       LEFT JOIN media_assets ma ON ps.media_asset_id = ma.id
       WHERE ps.id = $1`,
      [session.id],
    );

    if (trackResult.rows.length === 0) { return null; }

    const track = trackResult.rows[0];
    const positionMs = session.end_position_ms ?? session.start_position_ms ?? 0;
    const durationMs = track.recording_duration ?? 0;

    return {
      sessionId: session.id,
      startedAt: session.started_at,
      positionMs,
      listenedMs: session.listened_ms ?? 0,
      track: {
        id: track.recording_id,
        title: track.recording_title,
        durationMs,
        artistId: track.artist_id,
        artistName: track.artist_name,
        mediaAssetId: track.media_asset_id,
      },
      progressPercent: durationMs > 0
        ? Math.min(100, Math.round((positionMs / durationMs) * 100))
        : 0,
    };
  }

  /**
   * Получает историю воспроизведения для веб-плеера.
   * @param {string} userId
   * @param {Object} [options={}]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{ tracks: Array, total: number }>}
   */
  async getHistory(userId, options = {}) {
    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM playback_sessions
       WHERE user_id = $1 AND ended_at IS NOT NULL`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const sessionsResult = await this.pool.query(
      `SELECT ps.*, r.title AS recording_title, r.duration_ms AS recording_duration,
              a.name AS artist_name, ma.format
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       LEFT JOIN media_assets ma ON ps.media_asset_id = ma.id
       WHERE ps.user_id = $1 AND ps.ended_at IS NOT NULL
       ORDER BY ps.started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const tracks = sessionsResult.rows.map((row) => ({
      sessionId: row.id,
      recordingId: row.recording_id,
      recordingTitle: row.recording_title,
      recordingDuration: row.duration_ms,
      artistName: row.artist_name,
      format: row.format,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      listenedMs: row.listened_ms ?? 0,
      completed: row.completed ?? false,
    }));

    return { tracks, total };
  }

  /**
   * Получает список доступных медиа-ассетов для воспроизведения.
   * @param {string} userId
   * @param {Object} [options={}]
   * @param {number} [options.limit=20]
   * @param {number} [options.offset=0]
   * @returns {Promise<{ assets: Array, total: number }>}
   */
  async getAvailableAssets(userId, options = {}) {
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM media_assets ma
       WHERE ma.status = 'available'`,
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const assetsResult = await this.pool.query(
      `SELECT ma.id, ma.relative_path, ma.format, ma.bitrate_kbps,
              r.id AS recording_id, r.title AS recording_title,
              a.id AS artist_id, a.name AS artist_name
       FROM media_assets ma
       JOIN recordings r ON ma.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ma.status = 'available'
       ORDER BY ma.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    return { assets: assetsResult.rows, total };
  }

  // Private methods

  /**
   * Ищет трек в Navidrome по названию и исполнителю.
   */
  async _findInNavidrome(title, artistName) {
    if (!this.navidromeClient) { return null; }

    const results = await this.navidromeClient.searchSongs({
      song: title,
      artist: artistName,
    });

    // Exact match first
    for (const song of results) {
      if (
        song.title.toLowerCase() === title.toLowerCase() &&
        song.artist?.toLowerCase() === artistName.toLowerCase()
      ) {
        return song;
      }
    }

    // Fuzzy fallback: first result
    return results[0] ?? null;
  }
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {PlayerService}
 */
export function createPlayerService(deps) {
  return new PlayerService(deps);
}