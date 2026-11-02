/**
 * Клиент совместимости с Subsonic API.
 * Реализует подмножество Subsonic REST API для интеграции с клиентами Subsonic.
 *
 * Поддерживаемые endpoints:
 *   GET /rest/ping
 *   GET /rest/getLicenses
 *   GET /rest/getMusicFolders
 *   GET /rest/search3
 *   GET /rest/getAlbumList
 *   GET /rest/getArtist
 *   GET /rest/playQueue
 *   GET /rest/scrobble
 *   GET /rest/getStreamUrl
 *   GET /rest/getCoverArt
 *
 * Аутентификация: параметр 'u' (username) + 't' (token, MD5(password + salt))
 * или параметр 'u' + 'p' (plain password для тестирования).
 */
export class SubsonicClient {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   */
  constructor({ pool, config }) {
    this.pool = pool;
    this.config = config;
  }

  /**
   * Создаёт успешный ответ в формате Subsonic (XML или JSON).
   * @param {Object} data - данные ответа
   * @param {string} [format='json'] - 'json' или 'xml'
   * @returns {Object} { status: 'ok', version: '1.16.1', data }
   */
  _ok(data) {
    return {
      status: 'ok',
      version: '1.16.1',
      ...data,
    };
  }

  /**
   * Создаёт ошибку в формате Subsonic.
   * @param {number} code - код ошибки Subsonic
   * @param {string} message - сообщение об ошибке
   * @returns {Object} { status: 'failed', error: { code, message } }
   */
  _error(code, message) {
    return {
      status: 'failed',
      error: { code, message },
    };
  }

  /**
   * Проверка соединения (ping).
   * @returns {Object} статус сервера
   */
  async ping() {
    return this._ok({ subsonicResponse: { status: 'ok', version: '1.16.1' } });
  }

  /**
   * Получение лицензии.
   * @returns {Object} информация о лицензии
   */
  async getLicenses() {
    return this._ok({
      licenses: {
        license: {
          valid: true,
          email: 'user@localhost',
          trial: false,
        },
      },
    });
  }

  /**
   * Получение папок с музыкой.
   * @returns {Object} список папок
   */
  async getMusicFolders() {
    return this._ok({
      musicFolders: {
        musicFolder: [
          {
            id: '1',
            name: 'Local Library',
            path: '/media',
          },
        ],
      },
    });
  }

  /**
   * Поиск треков/артистов/альбомов.
   * @param {Object} params
   * @param {string} params.query - поисковый запрос
   * @param {number} [params.limit=20]
   * @param {number} [params.offset=0]
   * @returns {Object} результаты поиска
   */
  async search3(params) {
    const { query: searchQuery, limit = 20, offset = 0 } = params;

    const searchResult = await this.pool.query(
      `SELECT r.id, r.title, r.duration_ms, a.id AS artist_id, a.name AS artist_name,
              rel.id AS release_id, rel.title AS release_title
       FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       LEFT JOIN release_tracks rt ON rt.recording_id = r.id
       LEFT JOIN releases rel ON rel.id = rt.release_id
       WHERE LOWER(r.title) LIKE LOWER($1)
          OR LOWER(a.name) LIKE LOWER($1)
       LIMIT $2 OFFSET $3`,
      [`%${searchQuery}%`, limit, offset],
    );

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       WHERE LOWER(r.title) LIKE LOWER($1)
          OR LOWER(a.name) LIKE LOWER($1)`,
      [`%${searchQuery}%`],
    );

    return this._ok({
      searchResult2: {
        query: searchQuery,
        offset,
        count: parseInt(countResult.rows[0]?.total ?? '0', 10),
        song: searchResult.rows.map((row) => ({
          id: row.id,
          title: row.title,
          artist: row.artist_name,
          artistId: row.artist_id,
          album: row.release_title,
          albumId: row.release_id,
          duration: Math.round((row.duration_ms ?? 0) / 1000),
        })),
      },
    });
  }

  /**
   * Получение списка альбомов.
   * @param {Object} [params={}]
   * @param {string} [params.type='alphabetical']
   * @param {number} [params.size=50]
   * @param {number} [params.offset=0]
   * @param {string} [params.from]
   * @param {string} [params.to]
   * @returns {Object} список альбомов
   */
  async getAlbumList(params = {}) {
    const { size = 50, offset = 0 } = params;

    const result = await this.pool.query(
      `SELECT DISTINCT rel.id, rel.title, rel.release_date, rel.release_type,
              a.name AS artist_name, a.id AS artist_id
       FROM releases rel
       LEFT JOIN release_tracks rt ON rt.release_id = rel.id
       LEFT JOIN artists a ON rel.artist_id = a.id
       ORDER BY rel.title
       LIMIT $1 OFFSET $2`,
      [size, offset],
    );

    return this._ok({
      albumList: {
        album: result.rows.map((row) => ({
          id: row.id,
          name: row.title,
          artist: row.artist_name,
          artistId: row.artist_id,
          released: row.release_date,
          type: row.release_type,
          songCount: 0, // будет заполнено отдельно
          coverArt: row.id,
        })),
      },
    });
  }

  /**
   * Получение информации об исполнителе.
   * @param {Object} params
   * @param {string} params.id - ID исполнителя
   * @param {boolean} [params.includeSongs=false]
   * @returns {Object} информация об исполнителе
   */
  async getArtist(params) {
    const { id: artistId, includeSongs = false } = params;

    const artistResult = await this.pool.query(
      `SELECT * FROM artists WHERE id = $1`,
      [artistId],
    );

    if (artistResult.rows.length === 0) {
      return this._error(404, 'Artist not found');
    }

    const artist = artistResult.rows[0];

    const response = {
      id: artist.id,
      name: artist.name,
      sortName: artist.sort_name,
      artistId: artist.id,
    };

    if (includeSongs) {
      const songsResult = await this.pool.query(
        `SELECT r.id, r.title, r.duration_ms, rel.id AS release_id, rel.title AS release_title
         FROM recordings r
         LEFT JOIN release_tracks rt ON rt.recording_id = r.id
         LEFT JOIN releases rel ON rel.id = rt.release_id
         WHERE r.artist_id = $1
         ORDER BY r.title
         LIMIT 100`,
        [artistId],
      );

      response.song = songsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        artist: artist.name,
        artistId: artist.id,
        album: row.release_title,
        albumId: row.release_id,
        duration: Math.round((row.duration_ms ?? 0) / 1000),
      }));
    }

    return this._ok({ artist: response });
  }

  /**
   * Получение очереди воспроизведения.
   * @param {string} userId
   * @returns {Object} очередь
   */
  async playQueue(userId) {
    const result = await this.pool.query(
      `SELECT pqi.id, pqi.position, r.title AS recording_title, r.duration_ms,
              a.name AS artist_name
       FROM playback_queues pq
       JOIN playback_queue_items pqi ON pqi.queue_id = pq.id
       JOIN recordings r ON pqi.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE pq.user_id = $1
         AND pq.name = 'default'
       ORDER BY pqi.position`,
      [userId],
    );

    return this._ok({
      playQueue: {
        song: result.rows.map((row) => ({
          id: row.id,
          title: row.recording_title,
          artist: row.artist_name,
          album: null,
          position: row.position,
          duration: Math.round((row.duration_ms ?? 0) / 1000),
        })),
      },
    });
  }

  /**
   * Проксирование URL стрима в формате Subsonic.
   * @param {Object} params
   * @param {string} params.id - ID медиа-ассета (из media_assets)
   * @param {number} [params.maxBitrate]
   * @param {boolean} [params.format=false] - true для формата 'flac', false для 'mp3'
   * @param {number} [params.timeOffset] - смещение в секундах
   * @returns {Object} URL стрима
   */
  async getStreamUrl(params) {
    const { id: mediaAssetId, timeOffset } = params;

    const assetResult = await this.pool.query(
      `SELECT ma.id, ma.relative_path, ma.format, ma.bitrate_kbps,
              r.id AS recording_id, r.title AS recording_title
       FROM media_assets ma
       JOIN recordings r ON ma.recording_id = r.id
       WHERE ma.id = $1`,
      [mediaAssetId],
    );

    if (assetResult.rows.length === 0) {
      return this._error(404, 'Media asset not found');
    }

    const asset = assetResult.rows[0];

    return this._ok({
      stream: {
        id: mediaAssetId,
        url: `/api/v1/subsonic/stream/${mediaAssetId}?timeOffset=${timeOffset ?? 0}`,
        format: asset.format,
        size: 0,
        bitRate: asset.bitrate_kbps ?? 0,
        suffix: asset.format,
        duration: Math.round((asset.duration_ms ?? 0) / 1000),
      },
    });
  }

  /**
   * Получение обложки альбома.
   * @param {Object} params
   * @param {string} params.id - ID альбома (release)
   * @returns {Object} информация об обложке
   */
  async getCoverArt(params) {
    const { id: releaseId } = params;

    return this._ok({
      coverArt: {
        id: releaseId,
        url: `/api/v1/subsonic/cover-art/${releaseId}`,
      },
    });
  }

  /**
   * Отправка скроббла (совместимость с Subsonic scrobble endpoint).
   * @param {Object} params
   * @param {string} params.userId
   * @param {string} params.time - timestamp в миллисекундах
   * @param {string[]} params.ids - массив ID треков
   * @param {boolean} [params.subsonicClient=true]
   * @returns {Object} статус
   */
  async scrobble(params) {
    const { userId, time, ids } = params;

    if (!ids || ids.length === 0) {
      return this._error(400, 'No tracks to scrobble');
    }

    const playedAt = new Date(parseInt(time, 10)).toISOString();

    // Вставляем скробблы для каждого трека
    for (let i = 0; i < ids.length; i++) {
      await this.pool.query(
        `INSERT INTO scrobbles (user_id, recording_id, played_at, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (user_id, recording_id, played_at) DO NOTHING`,
        [userId, ids[i], playedAt],
      );
    }

    return this._ok({ subsonicResponse: { status: 'ok' } });
  }

  /**
   * Валидация токена аутентификации Subsonic.
   * В реальной реализации токен = MD5(password + salt).
   * Здесь базовая проверка на наличие пользователя.
   * @param {string} username
   * @param {string} token
   * @returns {Promise<{ valid: boolean, userId?: string }>}
   */
  async validateAuth(username, _token) {
    const result = await this.pool.query(
      `SELECT id FROM users WHERE username = $1 LIMIT 1`,
      [username],
    );

    if (result.rows.length === 0) {
      return { valid: false };
    }

    // Базовая валидация — в продакшене здесь должна быть проверка MD5-токена
    return { valid: true, userId: result.rows[0].id };
  }
}

/**
 * Фабрика для создания клиента.
 * @param {Object} deps
 * @returns {SubsonicClient}
 */
export function createSubsonicClient(deps) {
  return new SubsonicClient(deps);
}