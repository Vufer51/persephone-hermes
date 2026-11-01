/**
 * MusicBrainz API клиент с rate limiting и кэшированием.
 * Base URL: https://musicbrainz.org/ws/2/
 * Required User-Agent: PersephoneMusic/<version> (contact)
 */
export class MusicBrainzClient {
  /**
   * @param {Object} options
   * @param {string} options.userAgent - User-Agent header
   * @param {number} options.rateLimitMs - минимальный интервал между запросами (ms)
   * @param {import('pg').Pool} [options.pool] - пул БД для кэша (optional)
   */
  constructor({ userAgent, rateLimitMs = 6000, pool = null }) {
    this.baseUrl = 'https://musicbrainz.org/ws/2/';
    this.userAgent = userAgent;
    this.rateLimitMs = rateLimitMs;
    this.pool = pool;
    this.lastRequestTime = 0;
  }

  /**
   * Выполняет запрос с соблюдением rate limit.
   * @param {string} endpoint - API endpoint (например 'recording/<mbid>')
   * @param {Object} [params={}] - query parameters
   * @returns {Promise<Object|null>} JSON ответ или null при ошибке
   */
  async request(endpoint, params = {}) {
    await this._enforceRateLimit();

    const url = new URL(endpoint, this.baseUrl);
    url.searchParams.set('fmt', 'json');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }

    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': this.userAgent },
      });

      if (!response.ok) {
        if (response.status === 404) {return null;}
        if (response.status === 429) {
          await this._handleRateLimit(response);
          return this.request(endpoint, params);
        }
        throw new Error(`MusicBrainz API error: ${response.status}`);
      }

      return await response.json();
    } catch (err) {
      // Graceful degradation - возвращаем null, не бросаем ошибку
      console.warn(`MusicBrainz request failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Поиск записи по MusicBrainz ID.
   * @param {string} mbid
   * @returns {Promise<Object|null>}
   */
  async lookupRecording(mbid) {
    return this.request(`recording/${mbid}`, { inc: 'artist-credits+releases' });
  }

  /**
   * Поиск записи по имени артиста и названию трека.
   * @param {string} artistName
   * @param {string} recordingTitle
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async searchRecording(artistName, recordingTitle, limit = 10) {
    const query = `recording:"${recordingTitle}" AND artist:"${artistName}"`;
    const result = await this.request('recording', { query, limit });
    return result?.recordings ?? [];
  }

  /**
   * Поиск артиста по MusicBrainz ID.
   * @param {string} mbid
   * @returns {Promise<Object|null>}
   */
  async lookupArtist(mbid) {
    return this.request(`artist/${mbid}`, { inc: 'aliases' });
  }

  /**
   * Поиск артиста по имени.
   * @param {string} name
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async searchArtist(name, limit = 10) {
    const result = await this.request('artist', { query: `artist:"${name}"`, limit });
    return result?.artists ?? [];
  }

  /**
   * Поиск релиза по MusicBrainz ID.
   * @param {string} mbid
   * @returns {Promise<Object|null>}
   */
  async lookupRelease(mbid) {
    return this.request(`release/${mbid}`, { inc: 'recordings+artists' });
  }

  async _enforceRateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.rateLimitMs) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async _handleRateLimit(response) {
    const retryAfter = response.headers.get('Retry-After');
    const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.rateLimitMs * 2;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  /**
   * Получает кэшированный результат из БД.
   * @param {string} cacheKey
   * @returns {Promise<Object|null>}
   */
  async _getCached(cacheKey) {
    if (!this.pool) {return null;}
    const result = await this.pool.query(
      `SELECT payload FROM external_recommendation_cache WHERE source = 'musicbrainz' AND cache_key = $1 AND expires_at > NOW()`,
      [cacheKey],
    );
    return result.rows[0]?.payload ?? null;
  }

  /**
   * Сохраняет результат в кэш БД.
   * @param {string} cacheKey
   * @param {Object} payload
   * @param {number} ttlSeconds
   */
  async _setCache(cacheKey, payload, ttlSeconds = 86400) {
    if (!this.pool) {return;}
    await this.pool.query(
      `INSERT INTO external_recommendation_cache (source, cache_key, payload, expires_at)
       VALUES ('musicbrainz', $1, $2, NOW() + INTERVAL '${ttlSeconds} seconds')
       ON CONFLICT (source, cache_key) DO UPDATE SET payload = $2, expires_at = NOW() + INTERVAL '${ttlSeconds} seconds'`,
      [cacheKey, JSON.stringify(payload)],
    );
  }
}

/**
 * Фабрика для создания клиента с конфигурацией из окружения.
 * @param {Object} config
 * @param {import('pg').Pool} [pool]
 * @returns {MusicBrainzClient}
 */
export function createMusicBrainzClient(config, pool = null) {
  const version = config.version ?? '0.1.0';
  const contact = config.musicbrainzContact ?? 'persephone@example.com';
  const userAgent = `PersephoneMusic/${version} (${contact})`;
  return new MusicBrainzClient({ userAgent, pool });
}