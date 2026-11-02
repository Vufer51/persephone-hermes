import { randomUUID } from 'node:crypto';
import { LidarrClient } from './lidarr-client.js';

/**
 * Сервис автоматического скачивания музыки через Lidarr.
 * Используется внутренне: когда пользователь ищет или пытается прослушать
 * трек, которого нет локально — система сама запрашивает скачивание в Lidarr.
 * Пользователь не нажимает "скачать" — он просто видит библиотеку и включает трек.
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
    this._lidarrClient = lidarrClient;
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
   * @returns {LidarrClient|null}
   */
  _getLidarrClient() {
    if (this._lidarrClient) {
      return this._lidarrClient;
    }
    const lidarr = this.config.integrations?.lidarr ?? {};
    if (!lidarr.url || !lidarr.apiKey) {
      return null;
    }
    return new LidarrClient({
      baseUrl: lidarr.url,
      apiKey: lidarr.apiKey,
    });
  }

  /**
   * Проверить доступность трека локально.
   * @param {string} recordingId
   * @returns {Promise<{available: boolean, mediaAssetId?: string}>}
   */
  async checkAvailability(recordingId) {
    const result = await this.pool.query(
      `SELECT ma.id FROM media_assets ma
       WHERE ma.recording_id = $1 AND ma.status = 'available'
       LIMIT 1`,
      [recordingId],
    );
    return {
      available: result.rows.length > 0,
      mediaAssetId: result.rows[0]?.id ?? null,
    };
  }

  /**
   * Получить существующий download_request для записи пользователя.
   * @param {string} userId
   * @param {string} recordingId
   * @returns {Promise<Object|null>}
   */
  async _getExistingRequest(userId, recordingId) {
    const result = await this.pool.query(
      `SELECT * FROM download_requests
       WHERE user_id = $1 AND recording_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, recordingId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Создать запрос на скачивание и отправить в Lidarr.
   * Автоматически вызывается, когда пользователь пытается прослушать
   * трек, которого нет локально.
   *
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.recordingId
   * @param {string} params.artistName - имя исполнителя
   * @param {string} [params.artistMbId] - MusicBrainz ID исполнителя
   * @param {string} [params.recordingTitle] - название трека
   * @returns {Promise<Object>} { requestId, status, alreadyExists }
   */
  async requestDownload({ userId, recordingId, artistName, artistMbId, recordingTitle }) {
    if (!this._isConfigured()) {
      return {
        requestId: null,
        status: 'not_configured',
        error: 'Lidarr не настроен. Установите LIDARR_URL и LIDARR_API_KEY.',
      };
    }

    // Проверяем, нет ли уже активного запроса
    const existing = await this._getExistingRequest(userId, recordingId);
    if (existing) {
      return {
        requestId: existing.id,
        status: existing.status,
        alreadyExists: true,
        lidarrArtistId: existing.lidarr_artist_id,
      };
    }

    const requestId = randomUUID();

    // Создаём запрос со статусом pending
    await this.pool.query(
      `INSERT INTO download_requests (id, user_id, recording_id, artist_name, artist_mb_id, recording_title, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')`,
      [requestId, userId, recordingId, artistName, artistMbId ?? null, recordingTitle ?? null],
    );

    // Отправляем в Lidarr (добавляем артиста в библиотеку с monitored: true)
    try {
      await this.pool.query(
        `UPDATE download_requests SET status = 'sending', updated_at = NOW() WHERE id = $1`,
        [requestId],
      );

      const lidarr = this._getLidarrClient();
      if (!lidarr) {
        throw new Error('Lidarr client not initialized');
      }

      // Ищем исполнителя в Lidarr по MusicBrainz ID или имени
      let lidarrArtistId = null;
      if (artistMbId) {
        const searchResults = await lidarr.searchArtists(artistName);
        const match = searchResults.find(
          (a) => a.foreignArtistId === artistMbId || a.artistName?.toLowerCase() === artistName.toLowerCase()
        );
        if (match) {
          lidarrArtistId = match.id;
        }
      }

      // Добавляем исполнителя в Lidarr (если ещё не там)
      if (!lidarrArtistId) {
        const added = await lidarr.addArtist({
          artistName,
          artistId: 0,
          folderName: artistName,
        });
        lidarrArtistId = added.id ?? null;
      }

      await this.pool.query(
        `UPDATE download_requests
         SET lidarr_artist_id = $1, status = 'downloading', updated_at = NOW()
         WHERE id = $2`,
        [lidarrArtistId, requestId],
      );

      return {
        requestId,
        status: 'downloading',
        alreadyExists: false,
        lidarrArtistId,
      };
    } catch (err) {
      await this.pool.query(
        `UPDATE download_requests
         SET status = 'failed', error_message = $1, updated_at = NOW()
         WHERE id = $2`,
        [err.message, requestId],
      );
      return {
        requestId,
        status: 'failed',
        error: err.message,
      };
    }
  }

  /**
   * Получить статус запроса на скачивание.
   * @param {string} userId
   * @param {string} recordingId
   * @returns {Promise<{status: string, requestId?: string, error?: string}>}
   */
  async getDownloadStatus(userId, recordingId) {
    const existing = await this._getExistingRequest(userId, recordingId);
    if (!existing) {
      return { status: 'none' };
    }

    return {
      status: existing.status,
      requestId: existing.id,
      lidarrArtistId: existing.lidarr_artist_id,
      errorMessage: existing.error_message,
      createdAt: existing.created_at,
      updatedAt: existing.updated_at,
    };
  }

  /**
   * Синхронизировать статусы с Lidarr (для фонового вызова из ворклера).
   * Проверяет активные запросы и обновляет статус на основе состояния в Lidarr.
   * @param {string} [userId] - опционально, проверять только одного пользователя
   * @returns {Promise<Array>} обновлённые запросы
   */
  async syncStatuses(userId = null) {
    const whereClause = userId ? 'WHERE user_id = $1' : '';
    const params = userId ? [userId] : [];

    const requests = await this.pool.query(
      `SELECT id, lidarr_artist_id, status FROM download_requests
       ${whereClause}
       AND status IN ('sending', 'downloading')`,
      params,
    );

    const updated = [];
    const lidarr = this._getLidarrClient();
    if (!lidarr) {
      return updated;
    }

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