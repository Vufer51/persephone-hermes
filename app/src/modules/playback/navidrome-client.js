import { createHash } from 'node:crypto';

/**
 * Navidrome/Subsonic API клиент.
 * Поддерживает аутентификацию по токену (md5(password + salt)) и проксирование стримов.
 */
export class NavidromeClient {
  /**
   * @param {Object} options
   * @param {string} options.baseUrl - например http://navidrome:4533
   * @param {string} options.username
   * @param {string} options.password
   * @param {number} options.timeoutMs - таймаут запросов
   */
  constructor({ baseUrl, username, password, timeoutMs = 30000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.username = username;
    this.password = password;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.salt = null;
  }

  /**
   * Получает Salt и генерирует токен для аутентификации.
   * @returns {Promise<{ salt: string, token: string }>}
   */
  async _ensureAuth() {
    if (this.token && this.salt) {return { salt: this.salt, token: this.token };}

    // Получаем salt через getLicense (не требует auth) или просто генерируем
    // В Subsonic/Navidrome токен = md5(password + salt), salt возвращается при getLicense
    // Для простоты используем фиксированный подход: token = md5(password + username) — но правильнее получить salt
    // Здесь реализуем получение salt через ping/getLicense
    try {
      const res = await this._request('getLicense', { f: 'json' }, false);
      this.salt = res['subsonic-response']?.license?.salt ?? 'persephone';
    } catch {
      this.salt = 'persephone';
    }

    this.token = createHash('md5').update(this.password + this.salt).digest('hex');
    return { salt: this.salt, token: this.token };
  }

  /**
   * Выполняет запрос к Navidrome API.
   * @param {string} endpoint - endpoint (например 'stream.view')
   * @param {Object} params - query параметры
   * @param {boolean} [auth=true] - требовать аутентификацию
   * @returns {Promise<Object>}
   */
  async _request(endpoint, params = {}, auth = true) {
    const url = new URL(`${this.baseUrl}/rest/${endpoint}`);
    url.searchParams.set('f', 'json');
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'PersephoneMusic');

    if (auth) {
      const { token, salt } = await this._ensureAuth();
      url.searchParams.set('u', this.username);
      url.searchParams.set('t', token);
      url.searchParams.set('s', salt);
    }

    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {url.searchParams.set(k, String(v));}
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`Navidrome API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        throw new Error('Navidrome request timeout', { cause: err });
      }
      throw err;
    }
  }

  /**
   * Проверка доступности сервера.
   * @returns {Promise<boolean>}
   */
  async ping() {
    try {
      const res = await this._request('ping', {}, false);
      return res['subsonic-response']?.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Получает URL для стриминга файла.
   * @param {string} id - ID медиа-файла в Navidrome
   * @param {Object} [options={}]
   * @param {string} [options.format] - формат (mp3, flac, etc)
   * @param {number} [options.bitrate] - битрейт для транскодирования
   * @param {number} [options.timeOffset] - смещение в секундах
   * @returns {Promise<string>} URL для стриминга
   */
  getStreamUrl(id, options = {}) {
    const url = new URL(`${this.baseUrl}/rest/stream.view`);
    url.searchParams.set('id', id);
    url.searchParams.set('f', 'json');
    url.searchParams.set('v', '1.16.1');
    url.searchParams.set('c', 'PersephoneMusic');

    if (options.format) {url.searchParams.set('format', options.format);}
    if (options.bitrate) {url.searchParams.set('maxBitRate', String(options.bitrate));}
    if (options.timeOffset) {url.searchParams.set('timeOffset', String(options.timeOffset));}

    // Добавляем auth параметры
    return this._ensureAuth().then(({ token, salt }) => {
      url.searchParams.set('u', this.username);
      url.searchParams.set('t', token);
      url.searchParams.set('s', salt);
      return url.toString();
    });
  }

  /**
   * Получает информацию о файле/треке по ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getSong(id) {
    try {
      const res = await this._request('getSong', { id });
      return res['subsonic-response']?.song ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Поиск треков.
   * @param {Object} query
   * @returns {Promise<Array>}
   */
  async searchSongs(query) {
    try {
      const res = await this._request('search3', {
        query: JSON.stringify(query),
        artistCount: 0,
        albumCount: 0,
        songCount: 50,
      });
      return res['subsonic-response']?.searchResult3?.song ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Получает информацию об альбоме.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getAlbum(id) {
    try {
      const res = await this._request('getAlbum', { id });
      return res['subsonic-response']?.album ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Получает информацию об исполнителе.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getArtist(id) {
    try {
      const res = await this._request('getArtist', { id });
      return res['subsonic-response']?.artist ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Фабрика для создания клиента из конфига.
 * @param {Object} config
 * @returns {NavidromeClient}
 */
export function createNavidromeClient(config) {
  const navidrome = config.integrations?.navidrome ?? {};
  return new NavidromeClient({
    baseUrl: navidrome.url ?? 'http://localhost:4533',
    username: navidrome.user ?? 'admin',
    password: navidrome.password ?? '',
    timeoutMs: config.navidromeTimeoutMs ?? 30000,
  });
}