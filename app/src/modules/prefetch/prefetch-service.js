import { randomUUID } from 'node:crypto';

/**
 * Prefetch Service - предсказание и предварительная подготовка музыкального контента.
 * Прогноз следующих треков, проверка наличия файлов, управление задачами получения контента.
 */
export class PrefetchService {
  constructor({ pool, config }) {
    this.pool = pool;
    this.config = config;
  }

  /**
   * Прогноз следующих композиций для пользователя.
   * Стратегия: на основе истории прослушивания + рекомендаций + радио.
   */
  async predictNextTracks(userId, { limit = 5 } = {}) {
    const result = await this.pool.query(
      `SELECT DISTINCT ps.recording_id, ps.started_at,
              r.id AS recording_id, r.title AS recording_title, r.duration_ms,
              a.id AS artist_id, a.name AS artist_name
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ps.user_id = $1
         AND ps.ended_at IS NOT NULL
         AND ps.started_at >= NOW() - INTERVAL '7 days'
       ORDER BY ps.started_at DESC
       LIMIT $2`,
      [userId, limit],
    );
    return result.rows;
  }

  /**
   * Проверить наличие файла для записи.
   * @param {string} recordingId
   * @returns {Promise<Object|null>} media asset или null
   */
  async checkFileAvailability(recordingId) {
    const result = await this.pool.query(
      `SELECT ma.id, ma.relative_path, ma.format, ma.status, ma.sha256, ma.size_bytes
       FROM media_assets ma
       WHERE ma.recording_id = $1
         AND ma.status = 'available'
       LIMIT 1`,
      [recordingId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Создать задачу получения контента для записи.
   * @param {string} userId
   * @param {string} recordingId
   * @param {string} reason - 'radio', 'playlist', 'recommendation', 'manual'
   * @param {number} [priority=0]
   * @returns {Promise<Object>} созданная задача
   */
  async createPrefetchJob(userId, recordingId, reason, priority = 0) {
    // Проверяем, что задача не существует в активном состоянии
    const existingResult = await this.pool.query(
      `SELECT id FROM prefetch_jobs
       WHERE recording_id = $1
         AND status IN ('pending', 'queued', 'running')`,
      [recordingId],
    );

    if (existingResult.rows.length > 0) {
      return { jobId: existingResult.rows[0].id, created: false, reason: 'already_exists' };
    }

    const jobId = randomUUID();
    await this.pool.query(
      `INSERT INTO prefetch_jobs (id, recording_id, status, priority, attempt_count, max_attempts, created_at, updated_at)
       VALUES ($1, $2, 'pending', $3, 0, 5, NOW(), NOW())`,
      [jobId, recordingId, priority],
    );

    // Создаем запрос задачи
    await this.pool.query(
      `INSERT INTO prefetch_job_requests (job_id, user_id, reason, priority, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (job_id, user_id, reason) DO NOTHING`,
      [jobId, userId, reason, priority],
    );

    return { jobId, created: true, status: 'pending', priority, reason };
  }

  /**
   * Получить активные задачи получения контента для пользователя.
   * @param {string} userId
   * @param {Object} [options={}]
   * @param {number} [options.limit=50]
   * @param {number} [options.offset=0]
   * @returns {Promise<{ jobs: Array, total: number }>}
   */
  async getPrefetchJobs(userId, options = {}) {
    const limit = Math.min(options.limit ?? 50, 100);
    const offset = options.offset ?? 0;

    const countResult = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM prefetch_job_requests WHERE user_id = $1`,
      [userId],
    );
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10);

    const jobsResult = await this.pool.query(
      `SELECT pj.id AS job_id, pj.recording_id, pj.status, pj.priority,
              r.title AS recording_title, a.name AS artist_name,
              pjr.reason
       FROM prefetch_job_requests pjr
       JOIN prefetch_jobs pj ON pjr.job_id = pj.id
       JOIN recordings r ON pj.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE pjr.user_id = $1
       ORDER BY pj.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );

    return { jobs: jobsResult.rows, total };
  }

  /**
   * Получить задачу получения контента по ID.
   * @param {string} jobId
   * @returns {Promise<Object|null>}
   */
  async getPrefetchJob(jobId) {
    const result = await this.pool.query(
      `SELECT pj.*, r.title AS recording_title, a.name AS artist_name
       FROM prefetch_jobs pj
       JOIN recordings r ON pj.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE pj.id = $1`,
      [jobId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * Обновить статус задачи получения контента.
   * @param {string} jobId
   * @param {string} status - 'pending', 'queued', 'running', 'completed', 'failed', 'cancelled'
   * @param {string} [lastError]
   * @param {number} [attemptCount]
   */
  async updateJobStatus(jobId, status, lastError = null, attemptCount = null) {
    await this.pool.query(
      `UPDATE prefetch_jobs SET status = $1, updated_at = NOW(), last_error = $2, attempt_count = COALESCE($3, attempt_count)
       WHERE id = $4`,
      [status, lastError, attemptCount, jobId],
    );
  }

  /**
   * Получить активные задачи для обработки процессором.
   * @param {number} [limit=10]
   * @returns {Promise<Array>}
   */
  async getPendingJobs(limit = 10) {
    const result = await this.pool.query(
      `SELECT pj.*, r.title AS recording_title, a.name AS artist_name, pjr.user_id, pjr.reason
       FROM prefetch_jobs pj
       JOIN prefetch_job_requests pjr ON pj.id = pjr.job_id
       JOIN recordings r ON pj.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE pj.status IN ('pending', 'queued', 'running')
         AND pj.attempt_count < pj.max_attempts
       ORDER BY pj.priority DESC, pj.created_at ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }
}

/**
 * Фабрика для создания сервиса.
 * @param {Object} deps
 * @returns {PrefetchService}
 */
export function createPrefetchService(deps) {
  return new PrefetchService(deps);
}