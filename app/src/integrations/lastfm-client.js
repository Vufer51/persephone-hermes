import { createHash } from 'node:crypto';

/**
 * Last.fm API клиент для скробблинга.
 * Поддерживает track.scrobble, track.updateNowPlaying, auth.getSession.
 */
export class LastFmClient {
  /**
   * @param {Object} options
   * @param {string} options.apiKey
   * @param {string} options.sharedSecret
   * @param {string} options.baseUrl - например https://ws.audioscrobbler.com/2.0/
   * @param {number} options.timeoutMs
   */
  constructor({ apiKey, sharedSecret, baseUrl = 'https://ws.audioscrobbler.com/2.0/', timeoutMs = 30000 }) {
    this.apiKey = apiKey;
    this.sharedSecret = sharedSecret;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
  }

  /**
   * Генерирует подпись для метода.
   * @param {Object} params - параметры метода (без api_key, method, format)
   * @returns {string} md5 signature
   */
  _sign(params) {
    const sorted = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
    const sig = createHash('md5').update(sorted + this.sharedSecret).digest('hex');
    return sig;
  }

  /**
   * Выполняет подписанный POST запрос к Last.fm API.
   * @param {string} method - имя метода (например 'track.scrobble')
   * @param {Object} params - параметры метода
   * @param {string} sessionKey - session key пользователя
   * @returns {Promise<Object>} JSON ответ
   */
  async _signedPost(method, params, sessionKey) {
    const allParams = {
      method,
      api_key: this.apiKey,
      sk: sessionKey,
      format: 'json',
      ...params,
    };
    allParams.api_sig = this._sign(allParams);

    const url = new URL(this.baseUrl);
    url.search = new URLSearchParams(allParams).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Last.fm API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(`Last.fm error ${data.error}: ${data.message}`);
      }
      return data;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Last.fm request timeout', { cause: err });
      }
      throw err;
    }
  }

  /**
   * Обмен auth token на session key.
   * @param {string} token - токен из callback
   * @returns {Promise<string>} session key
   */
  async getSession(token) {
    const allParams = {
      method: 'auth.getSession',
      api_key: this.apiKey,
      token,
      format: 'json',
    };
    allParams.api_sig = this._sign(allParams);

    const url = new URL(this.baseUrl);
    url.search = new URLSearchParams(allParams).toString();

    const response = await fetch(url.toString(), { method: 'POST' });
    const data = await response.json();
    if (data.error) {throw new Error(`Last.fm auth error ${data.error}: ${data.message}`);}
    return data.session?.key ?? null;
  }

  /**
   * Отправляет скроббл (track.scrobble).
   * @param {Object} scrobble - данные скроббла
   * @param {string} scrobble.artist
   * @param {string} scrobble.track
   * @param {number} scrobble.timestamp - Unix timestamp
   * @param {string} [scrobble.album]
   * @param {number} [scrobble.duration] - длительность в секундах
   * @param {string} sessionKey
   * @returns {Promise<Object>}
   */
  async scrobble({ artist, track, timestamp, album, duration }, sessionKey) {
    return this._signedPost('track.scrobble', {
      artist,
      track,
      timestamp: String(timestamp),
      album: album ?? '',
      duration: duration ? String(duration) : '',
    }, sessionKey);
  }

  /**
   * Обновляет Now Playing (track.updateNowPlaying).
   * @param {Object} params
   * @param {string} sessionKey
   * @returns {Promise<Object>}
   */
  async updateNowPlaying({ artist, track, album, duration }, sessionKey) {
    return this._signedPost('track.updateNowPlaying', {
      artist,
      track,
      album: album ?? '',
      duration: duration ? String(duration) : '',
    }, sessionKey);
  }
}

/**
 * Фабрика для создания клиента из конфига.
 * @param {Object} config
 * @returns {LastFmClient}
 */
export function createLastFmClient(config) {
  const lastfm = config.integrations?.lastfm ?? {};
  return new LastFmClient({
    apiKey: lastfm.apiKey ?? '',
    sharedSecret: lastfm.sharedSecret ?? '',
    baseUrl: lastfm.baseUrl ?? 'https://ws.audioscrobbler.com/2.0/',
    timeoutMs: config.lastfmTimeoutMs ?? 30000,
  });
}