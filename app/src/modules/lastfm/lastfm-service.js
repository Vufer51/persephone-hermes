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
   */
  constructor({ pool, config }) {
    this.pool = pool;
    this.config = config;
    this.lastfmClient = createLastFmClient(config);
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
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {LastFmService}
 */
export function createLastFmService(deps) {
  return new LastFmService(deps);
}