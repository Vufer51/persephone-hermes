import { randomUUID } from 'node:crypto';
import { LidarrClient } from './lidarr-client.js';

/**
 * Сервис запросов на скачивание музыки через Lidarr.
 * Пользователь запрашивает скачивание исполнителя/трека,
 * мы отправляем в Lidarr, Lidarr скачивает через загрузчик (qBittorrent)
 * и импортирует в библиотеку.
 */
export class LidarrService {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {LidarrClient} [deps.lidarrClient]
   */
  constructor({ pool, config, lidarrClient = null }) {
    this.pool = pool;
    this.config = config;
    this.lidarrClient = lidarrClient;
  }

  /**
   * Проверить, настроен ли Lidarr (есть ли URL и API-ключ).
   * @returns {boolean}
   */
  _isConfigured() {
    return Boolean(
      this.config.integrations?.lidarr?.url &&
      this.config.integrations?.lidarr?.apiKey
    );
  }

  /**
   * Получить клиент Lidarr (создаёт при первом вызове).
   * @returns {LidarrClient}
   */
  _getLidarrClient() {
    if (this.lidarrClient) {
      return this.lidarrClient;
    }
    const lidarr = this.config.integrations?.lidarr ?? {};
    return new LidarrClient({
      baseUrl: lidarr.url,
      apiKey: lidarr.apiKey,
    });
  }

  /**
   * Запросить скачивание исполнителя через Lidarr.
   * Создаёт запись download_request с статусом 'pending',
   * затем отправляет в Lidarr (добавляет исполнителя в библиотеку с monitored: true).
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} [params.recordingId] - UUID записи (опционально)
   * @param {string} params.artistName - имя исполнителя
   * @param {string} [params.artistMbId] - MusicBrainz ID исполнителя
   * @returns {Promise<Object>} созданный запрос на скачивание
   */
  async requestDownload({ userId, recordingId, artistName, artistMbId }) {
    if (!this._isConfigured()) {
      throw new Error('Lidarr не настроен. Установите LIDARR_URL и LIDARR_API_KEY.');
    }

    // Проверяем, нет ли уже активного запроса для этой записи
    if (recordingId) {
      const existing = await this.pool.query(
        `SELECT id, status FROM download_requests
         WHERE user_id = $1 AND recording_id = $2
         AND status IN ('pending', 'sending', 'downloading')`,
        [userId, recordingId],
      );
      if (existing.rows.length > 0) {
        return { ...existing.rows[0], already_exists: true };
      }
    }

    const requestId = randomUUID();

    // Создаём запрос со статусом pending
    await this.pool.query(
      `INSERT INTO download_requests (id, user_id, recording_id, artist_name, artist_mb_id, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [requestId, userId, recordingId, artistName, artistMbId ?? null],
    );

    // Отправляем в Lidarr
    try {
      await this.pool.query(
        `UPDATE download_requests SET status = 'sending', updated_at = NOW() WHERE id = $1`,
        [requestId],
      );

      const lidarr = this._getLidarrClient();

      // Если есть MusicBrainz ID, ищем исполнителя в Lidarr по нему
      let lidarrArtistId = null;
      if (artistMbId) {
        const searchResults = await lidarr.searchArtists(artistName);
        const match = searchResults.find(
          (a) => a.foreignArtistId === artistMbId || a.artistName?.toLowerCase() === artistName.toLowerCase()
        );
        if (match) {
          lidarrArtistId = match.id;
          // Исполнитель уже есть в Lidarr — просто включаем мониторинг
          // (в реальности тут может быть PUT /api/v1/artist/{id} для обновления monitored)
          await this.pool.query(
            `UPDATE download_requests
             SET lidarr_artist_id = $1, status = 'downloading', updated_at = NOW()
             WHERE id = $2`,
            [lidarrArtistId, requestId],
          );
          return { id: requestId, status: 'downloading', lidarrArtistId, already_in_lidarr: true };
        }
      }

      // Добавляем исполнителя в Lidarr
      const added = await lidarr.addArtist({
        artistName,
        artistId: lidarrArtistId ?? 0,
        folderName: artistName,
      });

      lidarrArtistId = added.id ?? null;

      await this.pool.query(
        `UPDATE download_requests
         SET lidarr_artist_id = $1, status = 'downloading', updated_at = NOW()
         WHERE id = $2`,
        [lidarrArtistId, requestId],
      );

      return {
        id: requestId,
        status: 'downloading',
        lidarrArtistId,
        lidarrArtist: added,
      };
    } catch (err) {
      await this.pool.query(
        `UPDATE download_requests
         SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [err.message, requestId],
      );
      throw err;
    }
  }

  /**
   * Получить запросы на скачивание пользователя.
   * @param {string} userId
   * @param {Object} [options]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{ requests: Array, total: number }>}
   */
  async getDownloadRequests(userId, options = {}) {
    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM download_requests WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const requestsResult = await this.pool.query(
      `SELECT dr.*, r.title AS recording_title
       FROM download_requests dr
       LEFT JOIN recordings r ON dr.recording_id = r.id
       WHERE dr.user_id = $1
       ORDER BY dr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    const requests = requestsResult.rows.map((row) => ({
      id: row.id,
      recordingId: row.recording_id,
      recordingTitle: row.recording_title,
      artistName: row.artist_name,
      artistMbId: row.artist_mb_id,
      lidarrArtistId: row.lidarr_artist_id,
      status: row.status,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { requests, total };
  }

  /**
   * Получить запрос на скачивание по ID.
   * @param {string} requestId
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getDownloadRequest(requestId, userId) {
    const result = await this.pool.query(
      `SELECT dr.*, r.title AS recording_title
       FROM download_requests dr
       LEFT JOIN recordings r ON dr.recording_id = r.id
       WHERE dr.id = $1 AND dr.user_id = $2`,
      [requestId, userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Отменить запрос на скачивание.
   * @param {string} requestId
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async cancelDownloadRequest(requestId, userId) {
    const request = await this.getDownloadRequest(requestId, userId);
    if (!request) {
      return false;
    }

    if (request.status === 'pending' || request.status === 'sending') {
      await this.pool.query(
        `UPDATE download_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [requestId],
      );
      return true;
    }

    if (request.status === 'downloading' && request.lidarrArtistId) {
      // Удаляем исполнителя из Lidarr (без удаления файлов)
      try {
        const lidarr = this._getLidarrClient();
        await lidarr.deleteArtist(request.lidarrArtistId, false);
      } catch {
        // Игнорируем ошибку — всё равно отменяем у нас
      }
      await this.pool.query(
        `UPDATE download_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
        [requestId],
      );
      return true;
    }

    return false;
  }

  /**
   * Проверить статус запросов на скачивание (для фоновой синхронизации с Lidarr).
   * Может вызываться из ворклера для обновления статусов.
   * @param {string} [userId] - опционально, проверять только одного пользователя
   * @returns {Promise<Array>} обновлённые запросы
   */
  async syncStatuses(userId = null) {
    const whereClause = userId ? 'WHERE user_id = $1' : '';
    const params = userId ? [userId] : [];

    const requests = await this.pool.query(
      `SELECT id, lidarr_artist_id, status FROM download_requests
       ${whereClause}
       AND status IN ('downloading', 'sending')`,
      params,
    );

    const updated = [];
    const lidarr = this._getLidarrClient();

    for (const row of requests.rows) {
      if (!row.lidarr_artist_id) {
        continue;
      }

      try {
        const artist = await lidarr.getArtist(row.lidarr_artist_id);
        if (artist) {
          const isMonitored = artist.monitored !== false;
          const newStatus = isMonitored ? 'downloading' : 'completed';

          if (newStatus !== row.status) {
            await this.pool.query(
              `UPDATE download_requests SET status = $1, updated_at = NOW() WHERE id = $2`,
              [newStatus, row.id],
            );
            updated.push({ id: row.id, status: newStatus });
          }
        }
      } catch {
        // Игнорируем ошибки отдельных запросов
      }
    }

    return updated;
  }
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {LidarrService}
 */
export function createLidarrService(deps) {
  return new LidarrService(deps);
}