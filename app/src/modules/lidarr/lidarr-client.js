/**
 * Клиент Lidarr API v1.
 * Позволяет искать исполнителей и добавлять их в библиотеку Lidarr
 * для автоматического скачивания и импорта музыкальных файлов.
 *
 * Lidarr работает на уровне исполнителя: добавляем артиста с monitored: true,
 * и Lidarr сам ищет и скачивает его альбомы через настроенный загрузчик (qBittorrent).
 *
 * Документация API: https://wiki.servarr.com/lidarr/api
 */
export class LidarrClient {
  /**
   * @param {Object} deps
   * @param {string} deps.baseUrl - URL Lidarr, например http://lidarr:8686
   * @param {string} deps.apiKey - API-ключ Lidarr (Settings -> General -> API Key)
   */
  constructor({ baseUrl, apiKey }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Делает запрос к Lidarr API.
   * @param {string} path - путь API, например /api/v1/artist
   * @param {Object} [options] - опции fetch
   * @returns {Promise<any>}
   */
  async _request(path, options = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        'X-Api-Key': this.apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (response.status >= 400) {
      const text = await response.text().catch(() => '');
      throw new Error(`Lidarr API ${path} failed: ${response.status} ${text}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return response.json();
    }
    return response.text();
  }

  /**
   * Проверяет, что Lidarr API доступен.
   * @returns {Promise<Object>} статус системы
   */
  async ping() {
    return this._request('/api/v1/system/status');
  }

  /**
   * Поиск исполнителей по названию.
   * @param {string} term - поисковый запрос (имя исполнителя)
   * @param {number} [limit=10]
   * @returns {Promise<Array>} массив исполнителей
   */
  async searchArtists(term, limit = 10) {
    const result = await this._request(
      `/api/v1/artist?term=${encodeURIComponent(term)}`
    );
    return result.slice(0, limit);
  }

  /**
   * Получает список профилей качества (Quality Profiles).
   * @returns {Promise<Array>}
   */
  async getQualityProfiles() {
    return this._request('/api/v1/qualityprofile');
  }

  /**
   * Получает список корневых папок (Root Folders).
   * @returns {Promise<Array>}
   */
  async getRootFolders() {
    return this._request('/api/v1/rootfolder');
  }

  /**
   * Получает профили метаданных (Metadata Profiles).
   * @returns {Promise<Array>}
   */
  async getMetadataProfiles() {
    return this._request('/api/v1/metadataprofile');
  }

  /**
   * Добавляет исполнителя в библиотеку Lidarr для скачивания.
   * После добавления с monitored: true Lidarr сам будет искать и скачивать альбомы.
   *
   * @param {Object} artist
   * @param {string} artist.artistName - имя исполнителя
   * @param {string|number} [artist.artistId] - MusicBrainz ID или ID из Lidarr search
   * @param {string} [artist.folderName] - имя папки (по умолчанию как artistName)
   * @param {string} [artist.rootFolderPath] - путь к папке музыки
   * @param {number} [artist.qualityProfileId] - ID профиля качества
   * @param {number} [artist.metadataProfileId] - ID профиля метаданных
   * @returns {Promise<Object>} добавленный исполнитель с lidarr ID
   */
  async addArtist(artist) {
    const [
      qualityProfiles,
      rootFolders,
      metadataProfiles,
    ] = await Promise.all([
      this.getQualityProfiles(),
      this.getRootFolders(),
      this.getMetadataProfiles(),
    ]);

    const qualityProfile = qualityProfiles[0];
    const rootFolder = rootFolders[0];
    const metadataProfile = metadataProfiles[0];

    if (!qualityProfile) {
      throw new Error('В Lidarr не настроен ни один профиль качества (Quality Profile)');
    }
    if (!rootFolder) {
      throw new Error('В Lidarr не настроена ни одна корневая папка (Root Folder)');
    }

    const payload = {
      title: artist.artistName,
      artistId: artist.artistId ?? 0,
      folderName: artist.folderName ?? artist.artistName,
      rootFolderPath: artist.rootFolderPath ?? rootFolder.path,
      qualityProfileId: artist.qualityProfileId ?? qualityProfile.id,
      metadataProfileId: artist.metadataProfileId ?? metadataProfile.id,
      monitored: true,
      seriesType: 'artist',
      addOptions: {
        searchForMissingAlbums: true,
      },
    };

    return this._request('/api/v1/artist', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Получает исполнителя по ID.
   * @param {number|string} id
   * @returns {Promise<Object|null>}
   */
  async getArtist(id) {
    try {
      return this._request(`/api/v1/artist/${id}`);
    } catch (err) {
      if (err.message.includes('404')) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Удаляет исполнителя из библиотеки Lidarr.
   * @param {number|string} id
   * @param {boolean} [deleteFiles=false] - удалять ли файлы с диска
   * @returns {Promise<void>}
   */
  async deleteArtist(id, deleteFiles = false) {
    await this._request(
      `/api/v1/artist/${id}?deleteFiles=${deleteFiles}`,
      { method: 'DELETE' }
    );
  }
}

/**
 * Фабрика для создания клиента.
 * @param {Object} deps
 * @returns {LidarrClient}
 */
export function createLidarrClient(deps) {
  return new LidarrClient(deps);
}