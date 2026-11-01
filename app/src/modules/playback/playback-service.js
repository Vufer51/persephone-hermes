import { randomUUID } from 'node:crypto';
import { createNavidromeClient } from './navidrome-client.js';

/**
 * Сервис воспроизведения: управление сессиями, прокси стрима, история.
 */
export class PlaybackService {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {NavidromeClient} [deps.navidromeClient]
   */
  constructor({ pool, config, navidromeClient = null }) {
    this.pool = pool;
    this.config = config;
    this.navidromeClient = navidromeClient ?? createNavidromeClient(config);
  }

  /**
   * Начинает сессию воспроизведения.
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.recordingId
   * @param {string} params.mediaAssetId
   * @param {number} [params.startPositionMs=0]
   * @param {string} [params.source='api']
   * @returns {Promise<Object>} сессия
   */
  async startSession({ userId, recordingId, mediaAssetId, startPositionMs = 0, source = 'api' }) {
    const sessionId = randomUUID();
    const startedAt = new Date().toISOString();

    await this.pool.query(
      `INSERT INTO playback_sessions (id, user_id, recording_id, media_asset_id, started_at, start_position_ms, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sessionId, userId, recordingId, mediaAssetId, startedAt, startPositionMs, source],
    );

    return {
      id: sessionId,
      user_id: userId,
      recording_id: recordingId,
      media_asset_id: mediaAssetId,
      started_at: startedAt,
      start_position_ms: startPositionMs,
      source,
    };
  }

  /**
   * Обновляет позицию воспроизведения (heartbeat).
   * @param {string} sessionId
   * @param {number} positionMs
   * @returns {Promise<Object|null>} обновлённая сессия или null
   */
  async updatePosition(sessionId, positionMs) {
    const result = await this.pool.query(
      `UPDATE playback_sessions
       SET end_position_ms = $1,
           listened_ms = $1 - start_position_ms,
           updated_at = NOW()
       WHERE id = $2 AND ended_at IS NULL
       RETURNING *`,
      [positionMs, sessionId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Завершает сессию воспроизведения.
   * Если прослушано достаточно — создаёт запись в scrobbles для отправки в Last.fm.
   *
   * @param {string} sessionId
   * @param {number} [endPositionMs]
   * @returns {Promise<Object|null>} завершённая сессия
   */
  async endSession(sessionId, endPositionMs = null) {
    const sessionResult = await this.pool.query(
      `SELECT * FROM playback_sessions WHERE id = $1`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (!session) {return null;}

    const endedAt = new Date().toISOString();
    const listenedMs = endPositionMs ?? session.end_position_ms ?? 0;
    const completed = this._isCompleted(session.duration_ms, listenedMs);

    await this.pool.query(
      `UPDATE playback_sessions
       SET ended_at = $1,
           end_position_ms = COALESCE($2, end_position_ms),
           listened_ms = COALESCE($3, listened_ms),
           completed = $4
       WHERE id = $5`,
      [endedAt, endPositionMs, listenedMs, completed, sessionId],
    );

    // Если достаточно прослушано — ставим в очередь скробблинга
    if (completed) {
      await this._queueScrobble(session.user_id, session.recording_id, sessionId, endedAt);
    }

    return { ...session, ended_at: endedAt, end_position_ms: endPositionMs, listened_ms: listenedMs, completed };
  }

  /**
   * Получает стриминговый URL для медиа-ассета через Navidrome.
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

    // Ищем трек в Navidrome по названию и исполнителю
    const navidromeSong = await this._findInNavidrome(asset.title, asset.artist_name);
    if (!navidromeSong) {
      throw new Error('Track not found in Navidrome');
    }

    return this.navidromeClient.getStreamUrl(navidromeSong.id, {
      timeOffset: options.timeOffset,
    });
  }

  /**
   * Проксирует стрим от Navidrome с поддержкой Range запросов.
   * @param {string} mediaAssetId
   * @param {Object} request - Fastify request
   * @param {Object} reply - Fastify reply
   */
  async proxyStream(mediaAssetId, request, reply) {
    const streamUrl = await this.getStreamUrl(mediaAssetId, {
      timeOffset: request.query.timeOffset ? parseInt(request.query.timeOffset, 10) : undefined,
    });

    const range = request.headers.range;
    const headers = {};
    if (range) {headers.Range = range;}

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const upstream = await fetch(streamUrl, {
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      // Проксируем статус и заголовки
      reply.code(upstream.status);
      for (const [key, value] of upstream.headers.entries()) {
        if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
          reply.header(key, value);
        }
      }

      // Проксируем тело
      return upstream.body;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Stream timeout', { cause: err });
      }
      throw err;
    }
  }

  /**
   * Получает историю воспроизведения пользователя.
   * @param {string} userId
   * @param {Object} [options={}]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{ sessions: Array, total: number }>}
   */
  async getHistory(userId, options = {}) {
    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM playback_sessions WHERE user_id = $1 AND ended_at IS NOT NULL`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const sessionsResult = await this.pool.query(
      `SELECT ps.*, r.title AS recording_title, a.name AS artist_name
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ps.user_id = $1 AND ps.ended_at IS NOT NULL
       ORDER BY ps.started_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    return { sessions: sessionsResult.rows, total };
  }

  /**
   * Получает активную сессию пользователя.
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getActiveSession(userId) {
    const result = await this.pool.query(
      `SELECT * FROM playback_sessions
       WHERE user_id = $1 AND ended_at IS NULL
       ORDER BY started_at DESC LIMIT 1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  // Private methods

  /**
   * Ищет трек в Navidrome по названию и исполнителю.
   */
  async _findInNavidrome(title, artistName) {
    const results = await this.navidromeClient.searchSongs({
      song: title,
      artist: artistName,
    });

    // Exact match first
    for (const song of results) {
      if (song.title.toLowerCase() === title.toLowerCase() &&
          song.artist?.toLowerCase() === artistName.toLowerCase()) {
        return song;
      }
    }

    // Fuzzy fallback: first result
    return results[0] ?? null;
  }

  /**
   * Проверяет, достаточно ли прослушано для скробблинга.
   * Порог: 50% трека ИЛИ 4 минуты (240000 мс).
   */
  _isCompleted(durationMs, listenedMs) {
    if (!durationMs || !listenedMs) {return false;}
    const threshold = Math.min(durationMs * 0.5, 240000);
    return listenedMs >= threshold;
  }

  /**
   * Добавляет скроббл в очередь.
   */
  async _queueScrobble(userId, recordingId, playbackSessionId, playedAt) {
    await this.pool.query(
      `INSERT INTO scrobbles (user_id, recording_id, playback_session_id, played_at, status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (user_id, recording_id, played_at) DO NOTHING`,
      [userId, recordingId, playbackSessionId, playedAt],
    );
  }
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {PlaybackService}
 */
export function createPlaybackService(deps) {
  return new PlaybackService(deps);
}