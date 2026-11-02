import { createLastFmClient } from '../../integrations/lastfm-client.js';
import { createCryptoService } from '../auth/crypto-service.js';

/**
 * Сервис для управления подключением пользователя к Last.fm.
 * OAuth flow: auth URL → callback → сохранение зашифрованного session_key.
 */
export class LastFmService {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {Object} [deps.lastfmClient] — опциональный клиент для тестирования
   */
  constructor({ pool, config, lastfmClient = null }) {
    this.pool = pool;
    this.config = config;
    this.lastfmClient = lastfmClient ?? createLastFmClient(config);
    this.cryptoService = config.secrets?.encryptionKey
      ? createCryptoService(config.secrets.encryptionKey, config.secrets.encryptionKeyVersion ?? 1)
      : null;
  }

  /**
   * Генерирует URL для авторизации пользователя в Last.fm.
   * @param {string} callbackUrl - URL для редиректа после авторизации
   * @returns {string} auth URL
   */
  getAuthUrl(callbackUrl) {
    const lastfm = this.config.integrations?.lastfm ?? {};
    const apiKey = lastfm.apiKey ?? '';
    const baseUrl = lastfm.baseUrl?.replace(/\/+$/, '') ?? 'https://www.last.fm';
    const cb = encodeURIComponent(callbackUrl);

    return `${baseUrl}/api/auth/?api_key=${apiKey}&cb=${cb}`;
  }

  /**
   * Обрабатывает callback от Last.fm: обмен токена на session_key.
   * @param {string} token - токен из callback
   * @param {string} userId - UUID пользователя
   * @returns {Promise<Object>} результат подключения
   */
  async handleCallback(token, userId) {
    // Получаем session_key от Last.fm
    const sessionKey = await this.lastfmClient.getSession(token);
    if (!sessionKey) {
      throw new Error('Failed to get session key from Last.fm');
    }

    // Шифруем session_key
    if (!this.cryptoService) {
      throw new Error('Encryption not configured: config.secrets.encryptionKey is required');
    }
    const encrypted = this.cryptoService.encrypt(sessionKey);
    const keyVersion = this.config.secrets.encryptionKeyVersion ?? 1;

    // Сохраняем в БД
    await this.pool.query(
      `INSERT INTO user_lastfm (user_id, lastfm_username, session_key_encrypted, encryption_key_version, status)
       VALUES ($1, $2, $3, $4, 'connected')
       ON CONFLICT (user_id) DO UPDATE SET
         lastfm_username = $2,
         session_key_encrypted = $3,
         encryption_key_version = $4,
         status = 'connected',
         last_synced_at = NOW(),
         updated_at = NOW()`,
      [userId, '', encrypted, keyVersion], // username будет обновлён при первой синхронизации
    );

    return { connected: true, sessionKey: '***' };
  }

  /**
   * Получает статус подключения пользователя к Last.fm.
   * @param {string} userId
   * @returns {Promise<Object|null>}
   */
  async getStatus(userId) {
    const result = await this.pool.query(
      `SELECT lastfm_username, status, last_synced_at, encryption_key_version
       FROM user_lastfm WHERE user_id = $1`,
      [userId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Отключает Last.fm аккаунт пользователя.
   * @param {string} userId
   * @returns {Promise<boolean>}
   */
  async disconnect(userId) {
    const result = await this.pool.query(
      `UPDATE user_lastfm SET status = 'disconnected', updated_at = NOW() WHERE user_id = $1`,
      [userId],
    );
    return result.rowCount > 0;
  }

  /**
   * Расшифровывает session_key для пользователя.
   * @param {string} userId
   * @returns {Promise<string|null>}
   */
  async getDecryptedSessionKey(userId) {
    const result = await this.pool.query(
      `SELECT session_key_encrypted, encryption_key_version
       FROM user_lastfm WHERE user_id = $1 AND status = 'connected'`,
      [userId],
    );
    if (result.rows.length === 0) {return null;}

    if (!this.cryptoService) {return null;}

    const { session_key_encrypted, encryption_key_version } = result.rows[0];
    return this.cryptoService.decrypt(session_key_encrypted, encryption_key_version);
  }

  /**
   * Отправляет Now Playing в Last.fm (track.updateNowPlaying).
   * @param {string} userId
   * @param {Object} track - { artist, track, album, duration }
   * @returns {Promise<Object>}
   */
  async updateNowPlaying(userId, { artist, track, album, duration }) {
    const sessionKey = await this.getDecryptedSessionKey(userId);
    if (!sessionKey) {
      throw new Error('Last.fm not connected or encryption not configured');
    }

    return this.lastfmClient.updateNowPlaying({ artist, track, album, duration }, sessionKey);
  }

  /**
   * Полная синхронизация данных пользователя с Last.fm.
   * Загружает: loved tracks, top artists (overall/periods), recent tracks.
   * @param {string} userId
   * @returns {Promise<Object>} результат синхронизации
   */
  async syncUserData(userId) {
    const sessionKey = await this.getDecryptedSessionKey(userId);
    if (!sessionKey) {
      throw new Error('Last.fm not connected or encryption not configured');
    }

    const results = {
      lovedTracks: 0,
      topArtists: 0,
      recentTracks: 0,
      errors: [],
    };

    // 1. Loved tracks
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const data = await this.lastfmClient.getLovedTracks(sessionKey, { limit: 50, page });
        const tracks = data.lovedtracks?.track ?? [];
        totalPages = parseInt(data.lovedtracks?.['@attr']?.totalPages ?? '1', 10);

        for (const lt of tracks) {
          await this._upsertLovedTrack(userId, lt);
        }
        results.lovedTracks += tracks.length;
        page++;
        await this._rateLimitDelay();
      }
    } catch (err) {
      results.errors.push({ type: 'lovedTracks', message: err.message });
    }

    // 2. Top artists (overall)
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const data = await this.lastfmClient.getTopArtists(sessionKey, { period: 'overall', limit: 50, page });
        const artists = data.topartists?.artist ?? [];
        totalPages = parseInt(data.topartists?.['@attr']?.totalPages ?? '1', 10);

        for (const at of artists) {
          await this._upsertTopArtist(userId, at, 'overall');
        }
        results.topArtists += artists.length;
        page++;
        await this._rateLimitDelay();
      }
    } catch (err) {
      results.errors.push({ type: 'topArtists', message: err.message });
    }

    // 3. Recent tracks
    try {
      let page = 1;
      let totalPages = 1;
      while (page <= totalPages) {
        const data = await this.lastfmClient.getRecentTracks(sessionKey, { limit: 50, page });
        const tracks = data.recenttracks?.track ?? [];
        totalPages = parseInt(data.recenttracks?.['@attr']?.totalPages ?? '1', 10);

        for (const rt of tracks) {
          if (!rt['@attr']?.nowplaying) {
            await this._upsertRecentTrack(userId, rt);
          }
        }
        results.recentTracks += tracks.filter(t => !t['@attr']?.nowplaying).length;
        page++;
        await this._rateLimitDelay();
      }
    } catch (err) {
      results.errors.push({ type: 'recentTracks', message: err.message });
    }

    // Обновляем last_synced_at
    await this.pool.query(
      `UPDATE user_lastfm SET last_synced_at = NOW(), updated_at = NOW() WHERE user_id = $1`,
      [userId],
    );

    return results;
  }

  /**
   * Задержка для соблюдения rate limit (1 req/sec).
   */
  async _rateLimitDelay() {
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }

  /**
   * Сохраняет любимый трек в user_track_preferences.
   */
  async _upsertLovedTrack(userId, lt) {
    const artistName = lt.artist?.name ?? lt.artist?.['#text'] ?? '';
    const trackName = lt.name ?? '';

    // Находим recording по названию и артисту
    const recResult = await this.pool.query(
      `SELECT r.id FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       WHERE lower(r.title) = lower($1) AND lower(a.name) = lower($2)
       LIMIT 1`,
      [trackName, artistName],
    );

    if (recResult.rows.length === 0) {return;}

    const recordingId = recResult.rows[0].id;

    await this.pool.query(
      `INSERT INTO user_track_preferences (user_id, recording_id, affinity_score, play_count, skip_count, last_played_at, updated_at)
       VALUES ($1, $2, 1.0, 0, 0, NOW(), NOW())
       ON CONFLICT (user_id, recording_id) DO UPDATE SET
         affinity_score = GREATEST(user_track_preferences.affinity_score, 1.0),
         last_played_at = NOW(),
         updated_at = NOW()`,
      [userId, recordingId],
    );

    // Также добавляем в user_likes
    await this.pool.query(
      `INSERT INTO user_likes (user_id, recording_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, recordingId],
    );
  }

  /**
   * Сохраняет топ исполнителя в user_artist_preferences.
   */
  async _upsertTopArtist(userId, at, _period) {
    const artistName = at.name ?? '';

    const artResult = await this.pool.query(
      `SELECT id FROM artists WHERE lower(name) = lower($1) LIMIT 1`,
      [artistName],
    );

    if (artResult.rows.length === 0) {return;}

    const artistId = artResult.rows[0].id;
    const playcount = parseInt(at.playcount ?? '0', 10);

    await this.pool.query(
      `INSERT INTO user_artist_preferences (user_id, artist_id, affinity_score, play_count, skip_count, updated_at)
       VALUES ($1, $2, LEAST(1.0, $3 / 1000.0), $3, 0, NOW())
       ON CONFLICT (user_id, artist_id) DO UPDATE SET
         affinity_score = GREATEST(user_artist_preferences.affinity_score, LEAST(1.0, $3 / 1000.0)),
         play_count = GREATEST(user_artist_preferences.play_count, $3),
         updated_at = NOW()`,
      [userId, artistId, playcount],
    );
  }

  /**
   * Сохраняет недавний трек в user_track_preferences (play_count++).
   */
  async _upsertRecentTrack(userId, rt) {
    const artistName = rt.artist?.['#text'] ?? rt.artist?.name ?? '';
    const trackName = rt.name ?? '';

    const recResult = await this.pool.query(
      `SELECT r.id FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       WHERE lower(r.title) = lower($1) AND lower(a.name) = lower($2)
       LIMIT 1`,
      [trackName, artistName],
    );

    if (recResult.rows.length === 0) {return;}

    const recordingId = recResult.rows[0].id;

    await this.pool.query(
      `INSERT INTO user_track_preferences (user_id, recording_id, affinity_score, play_count, skip_count, last_played_at, updated_at)
       VALUES ($1, $2, 0.1, 1, 0, NOW(), NOW())
       ON CONFLICT (user_id, recording_id) DO UPDATE SET
         play_count = user_track_preferences.play_count + 1,
         affinity_score = LEAST(1.0, user_track_preferences.affinity_score + 0.05),
         last_played_at = NOW(),
         updated_at = NOW()`,
      [userId, recordingId],
    );
  }
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {LastFmService}
 */
export function createLastFmService(deps) {
  return new LastFmService(deps);
}