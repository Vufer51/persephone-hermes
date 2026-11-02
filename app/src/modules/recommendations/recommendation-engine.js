/**
 * Recommendation Engine - персонализированные рекомендации треков/исполнителей и радио.
 * Использует пользовательские предпочтения, историю прослушиваний и метрики сходства.
 */
export class RecommendationEngine {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {Object} [deps.userPreferences] - кэш предпочтений пользователя {artistId -> score, recordingId -> score}
   */
  constructor({ pool, config, userPreferences = null }) {
    this.pool = pool;
    this.config = config;
    this.userPreferences = userPreferences; // { userId -> { artistId -> score, recordingId -> score } }
  }

  /**
   * Generate candidate tracks for a user.
   * @param {string} userId
   * @param {Object} options - options object
   * @param {number} [options.limit=20] - max candidates
   * @param {number} [options.diversity=0.5] - 0=most similar, 1=most diverse
   * @returns {Promise<Array>} candidates {recordingId, artistId, score, reason}
   */
  async generateCandidates(userId, options) {
    const limit = options?.limit ?? 20;
    const diversity = options?.diversity ?? 0.5;
    const candidates = [];

    const likedResult = await this.pool.query(
      `SELECT ul.recording_id, r.title, r.duration_ms, a.id AS artist_id, a.name AS artist_name
       FROM user_likes ul
       JOIN recordings r ON ul.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ul.user_id = $1`,
      [userId],
    );

    for (let i = 0; i < likedResult.rows.length; i++) {
      const row = likedResult.rows[i];
      candidates.push({
        recordingId: row.recording_id,
        artistId: row.artist_id,
        title: row.title,
        durationMs: row.duration_ms,
        score: 0.8,
        reason: 'liked',
      });
    }

    const topArtistsResult = await this.pool.query(
      `SELECT artist_id, affinity_score
       FROM user_artist_preferences
       WHERE user_id = $1
       ORDER BY affinity_score DESC
       LIMIT 5`,
      [userId],
    );

    for (let i = 0; i < topArtistsResult.rows.length; i++) {
      const row = topArtistsResult.rows[i];
      const artistId = row.artist_id;

      const artistTracksResult = await this.pool.query(
        `SELECT r.id, r.title, r.duration_ms
         FROM recordings r
         WHERE r.artist_id = $1
         ORDER BY random()
         LIMIT 3`,
      [artistId],
    );

    for (let j = 0; j < artistTracksResult.rows.length; j++) {
      const track = artistTracksResult.rows[j];
      const existing = candidates.find(c => c.recordingId === track.id);
      const baseScore = 0.5 * diversity + 0.2;
      candidates.push({
        recordingId: track.id,
        artistId,
        title: track.title,
        durationMs: track.duration_ms,
        score: existing ? Math.max(existing.score, baseScore) : baseScore,
        reason: 'similar_artist',
      });
    }

    const recentPlayedResult = await this.pool.query(
      `SELECT DISTINCT r.id, r.title, r.duration_ms, a.id AS artist_id, a.name AS artist_name
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ps.user_id = $1
         AND ps.ended_at IS NOT NULL
         AND ps.started_at >= NOW() - INTERVAL '30 days'
       ORDER BY ps.started_at DESC
       LIMIT 5`,
      [userId],
    );

    for (let k = 0; k < recentPlayedResult.rows.length; k++) {
      const row = recentPlayedResult.rows[k];
      const existing = candidates.find(c => c.recordingId === row.id);
      const baseScore = 0.6 * (1 - diversity);
      candidates.push({
        recordingId: row.id,
        artistId: row.artist_id,
        title: row.title,
        durationMs: row.duration_ms,
        score: existing ? Math.max(existing.score, baseScore) : baseScore,
        reason: 'recently_played',
      });
    }

    const seen = new Set();
    const unique = candidates.filter(c => {
      if (seen.has(c.recordingId)) {
        return false;
      }
      seen.add(c.recordingId);
      return true;
    });

    unique.sort((a, b) => b.score - a.score);
    return unique.slice(0, limit);
  }
  }

  async getRadio(seedRecordingId, options) {
    const limit = options?.limit ?? 15;
    const diversity = options?.diversity ?? 0.3;

    const seedResult = await this.pool.query(
      `SELECT r.id, r.title, r.duration_ms, a.id AS artist_id, a.name AS artist_name
       FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       WHERE r.id = $1`,
      [seedRecordingId],
    );

    if (seedResult.rows.length === 0) {
      return [];
    }

    const seed = seedResult.rows[0];
    const candidates = [];

    candidates.push({
      recordingId: seed.id,
      artistId: seed.artist_id,
      title: seed.title,
      durationMs: seed.duration_ms,
      score: 1.0,
      reason: 'seed',
    });

    const similarArtistsResult = await this.pool.query(
      `SELECT DISTINCT a.id AS artist_id, a.name AS artist_name
       FROM recordings r
       JOIN artists a ON r.artist_id = a.id
       WHERE r.artist_id = $1`,
      [seed.artist_id],
    );

    for (let m = 0; m < similarArtistsResult.rows.length; m++) {
      const row = similarArtistsResult.rows[m];
      const artistId = row.artist_id;

      const similarTracksResult = await this.pool.query(
        `SELECT r.id, r.title, r.duration_ms
         FROM recordings r
         WHERE r.artist_id = $1
         ORDER BY random()
         LIMIT 2`,
      [artistId],
    );

    for (let n = 0; n < similarTracksResult.rows.length; n++) {
      const track = similarTracksResult.rows[n];
      const diversityBoost = diversity;
      const baseScore = 0.5 * (1 - diversityBoost) + 0.1;
      candidates.push({
        recordingId: track.id,
        artistId,
        title: track.title,
        durationMs: track.duration_ms,
        score: baseScore,
        reason: 'radio_similar_artist',
      });
    }

    const recentResult = await this.pool.query(
      `SELECT DISTINCT r.id, r.title, r.duration_ms, a.id AS artist_id, a.name AS artist_name
       FROM playback_sessions ps
       JOIN recordings r ON ps.recording_id = r.id
       JOIN artists a ON r.artist_id = a.id
       WHERE ps.user_id IS NOT NULL
         AND ps.ended_at IS NOT NULL
       ORDER BY random()
       LIMIT 3`,
    );

    for (let p = 0; p < recentResult.rows.length; p++) {
      const row = recentResult.rows[p];
      const existing = candidates.find(c => c.recordingId === row.id);
      const baseScore = 0.3 * (1 - diversity);
      candidates.push({
        recordingId: row.id,
        artistId: row.artist_id,
        title: row.title,
        durationMs: row.duration_ms,
        score: existing ? Math.max(existing.score, baseScore) : baseScore,
        reason: 'radio_recent',
      });
    }

    const seen = new Set();
    const unique = candidates.filter(c => {
      if (seen.has(c.recordingId)) {
        return false;
      }
      seen.add(c.recordingId);
      return true;
    });

    unique.sort((a, b) => b.score - a.score);
    return unique.slice(0, limit);
  }
  }

  async getExplanations(userId, candidates) {
    const enhanced = [];

    for (let e = 0; e < candidates.slice(0, 5).length; e++) {
      const candidate = candidates.slice(0, 5)[e];
      let explanation = '';

      const prefResult = await this.pool.query(
        `SELECT affinity_score FROM user_track_preferences WHERE user_id = $1 AND recording_id = $2`,
        [userId, candidate.recordingId],
      );

      if (prefResult.rows.length > 0) {
        const score = prefResult.rows[0].affinity_score / 100;
        explanation += `You have a ${score.toFixed(1)} affinity for this track. `;
      }

      const artistResult = await this.pool.query(
        `SELECT affinity_score FROM user_artist_preferences WHERE user_id = $1 AND artist_id = $2`,
        [userId, candidate.artistId],
      );

      if (artistResult.rows.length > 0) {
        explanation += `You often listen to ${artistResult.rows[0].artist_name?.replace(/[,;]/, ' and ')}. `;
      }

      const recentResult = await this.pool.query(
        `SELECT COUNT(*) AS cnt FROM playback_sessions ps
         JOIN recordings r ON ps.recording_id = r.id
         WHERE ps.user_id = $1
           AND ps.ended_at IS NOT NULL
           AND r.id = $2
           AND ps.started_at >= NOW() - INTERVAL '7 days'`,
        [userId, candidate.recordingId],
      );

      if (recentResult.rows[0]?.cnt > 0) {
        explanation += `You recently played this track. `;
      }

      if (!explanation) {
        explanation = 'Based on your listening history and similar tracks.';
      }

      enhanced.push({
        ...candidate,
        explanation: explanation.trim(),
      });
    }

    return enhanced;
  }
}

export function createRecommendationEngine({ pool, config, userPreferences }) {
  return new RecommendationEngine({ pool, config, userPreferences });
}

/**
 * Регистрирует маршруты рекомендаций.
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRoutes(app) {
  const { database } = app.dependencies;
  const engine = createRecommendationEngine({ pool: database.pool, config: app.config });

  // GET /api/v1/recommendations/candidates — кандидаты для пользователя
  app.get('/api/v1/recommendations/candidates', {
    preHandler: [app.authMiddleware],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          diversity: { type: 'number', minimum: 0, maximum: 1, default: 0.5 },
        },
      },
    },
    handler: async (request) => {
      const userId = request.user.id;
      const { limit = 20, diversity = 0.5 } = request.query;
      return engine.generateCandidates(userId, { limit, diversity });
    },
  });

  // GET /api/v1/recommendations/radio/:seedRecordingId — радио из трека
  app.get('/api/v1/recommendations/radio/:seedRecordingId', {
    preHandler: [app.authMiddleware],
    schema: {
      params: {
        type: 'object',
        required: ['seedRecordingId'],
        properties: { seedRecordingId: { type: 'string', format: 'uuid' } },
      },
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 15 },
          diversity: { type: 'number', minimum: 0, maximum: 1, default: 0.3 },
        },
      },
    },
    handler: async (request) => {
      const { seedRecordingId } = request.params;
      const { limit = 15, diversity = 0.3 } = request.query;
      return engine.getRadio(seedRecordingId, { limit, diversity });
    },
  });

  // GET /api/v1/recommendations/explanations — объяснения для кандидатов
  app.post('/api/v1/recommendations/explanations', {
    preHandler: [app.authMiddleware],
    schema: {
      body: {
        type: 'object',
        required: ['candidates'],
        properties: {
          candidates: { type: 'array' },
        },
      },
    },
    handler: async (request) => {
      const userId = request.user.id;
      const { candidates } = request.body;
      return engine.getExplanations(userId, candidates);
    },
  });
}