/**
 * Scrobble Processor — фоновый процессор для отправки скробблов в Last.fm.
 * Опрашивает таблицу scrobbles, отправляет pending скробблы, обновляет статусы.
 */
export class ScrobbleProcessor {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {Object} deps.cryptoService - { decrypt }
   * @param {LastFmClient} deps.lastfmClient
   * @param {number} [deps.pollIntervalMs=30000]
   * @param {number} [deps.maxConcurrent=5]
   */
  constructor({ pool, config, cryptoService, lastfmClient, pollIntervalMs = 30000, maxConcurrent = 5 }) {
    this.pool = pool;
    this.config = config;
    this.cryptoService = cryptoService;
    this.lastfmClient = lastfmClient;
    this.pollIntervalMs = pollIntervalMs;
    this.maxConcurrent = maxConcurrent;
    this.running = false;
    this.pollTimer = null;
    this.processing = new Set();
  }

  /**
   * Запускает процессор.
   */
  start() {
    if (this.running) {return;}
    this.running = true;
    this._poll();
  }

  /**
   * Останавливает процессор (graceful).
   */
  async stop() {
    this.running = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    // Ждём завершения текущих задач
    while (this.processing.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Основной цикл опроса.
   */
  async _poll() {
    if (!this.running) {return;}

    try {
      await this._processBatch();
    } catch (err) {
      console.error('ScrobbleProcessor poll error:', err);
    }

    if (this.running) {
      this.pollTimer = setTimeout(() => this._poll(), this.pollIntervalMs);
    }
  }

  /**
   * Обрабатывает батч pending скробблов.
   */
  async _processBatch() {
    // Получаем pending скробблы с данными пользователя и трека
    const result = await this.pool.query(
      `SELECT s.id, s.user_id, s.recording_id, s.played_at, s.attempt_count, s.max_attempts,
              u.lastfm_username, u.session_key_encrypted, u.encryption_key_version,
              r.title AS recording_title, r.duration_ms,
              a.name AS artist_name
       FROM scrobbles s
       JOIN user_lastfm u ON s.user_id = u.user_id
       JOIN recordings r ON s.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE s.status = 'pending'
         AND u.status = 'connected'
         AND s.attempt_count < s.max_attempts
       ORDER BY s.created_at
       LIMIT $1`,
      [this.maxConcurrent],
    );

    const scrobbles = result.rows;
    if (scrobbles.length === 0) {return;}

    // Обрабатываем параллельно с ограничением concurrency
    await Promise.all(
      scrobbles.map((scrobble) => this._processScrobble(scrobble)),
    );
  }

  /**
   * Обрабатывает один скроббл.
   */
  async _processScrobble(scrobble) {
    const scrobbleId = scrobble.id;
    this.processing.add(scrobbleId);

    try {
      // Расшифровываем session_key
      const sessionKey = await this.cryptoService.decrypt(
        scrobble.session_key_encrypted,
        scrobble.encryption_key_version,
      );
      if (!sessionKey) {
        throw new Error('Failed to decrypt session key');
      }

      // Отправляем в Last.fm
      await this.lastfmClient.scrobble({
        artist: scrobble.artist_name,
        track: scrobble.recording_title,
        timestamp: Math.floor(new Date(scrobble.played_at).getTime() / 1000),
        duration: scrobble.duration_ms ? Math.round(scrobble.duration_ms / 1000) : undefined,
      }, sessionKey);

      // Успех — помечаем sent
      await this.pool.query(
        `UPDATE scrobbles SET status = 'sent', last_attempt_at = NOW() WHERE id = $1`,
        [scrobbleId],
      );
    } catch (err) {
      // Ошибка — увеличиваем attempt_count, сохраняем ошибку
      const newAttempts = scrobble.attempt_count + 1;
      const status = newAttempts >= scrobble.max_attempts ? 'failed' : 'pending';

      await this.pool.query(
        `UPDATE scrobbles
         SET status = $1, attempt_count = $2, last_attempt_at = NOW(), last_error = $3
         WHERE id = $4`,
        [status, newAttempts, err.message, scrobbleId],
      );
    } finally {
      this.processing.delete(scrobbleId);
    }
  }

  /**
   * Возвращает статус процессора.
   */
  getStatus() {
    return {
      running: this.running,
      processingCount: this.processing.size,
      pollIntervalMs: this.pollIntervalMs,
    };
  }
}

/**
 * Фабрика для создания процессора.
 */
export function createScrobbleProcessor(deps) {
  return new ScrobbleProcessor(deps);
}