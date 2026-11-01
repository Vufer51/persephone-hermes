import { createMusicBrainzClient } from './musicbrainz-client.js';

/**
 * Сервис сопоставления локальных записей с MusicBrainz.
 * Использует exact matching → fuzzy matching (Levenshtein).
 */
export class RecordingMatcher {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {MusicBrainzClient} [deps.mbClient]
   * @param {Object} [deps.config]
   */
  constructor({ pool, mbClient = null, config = {} }) {
    this.pool = pool;
    this.mbClient = mbClient;
    this.config = {
      fuzzyThreshold: config.fuzzyThreshold ?? 0.85,
      ...config,
    };
  }

  /**
   * Пытается найти MusicBrainz ID для локальной записи.
   * Стратегия: exact title+artist → fuzzy title+artist.
   *
   * @param {Object} recording - локальная запись { id, title, artist_name, artist_id }
   * @returns {Promise<string|null>} MusicBrainz recording ID или null
   */
  async matchRecording(recording) {
    if (!this.mbClient) {return null;}

    // 1. Exact match by title + artist
    const exactMatches = await this.mbClient.searchRecording(
      recording.artist_name,
      recording.title,
      5,
    );

    for (const mbRecording of exactMatches) {
      if (this._titlesMatch(mbRecording.title, recording.title) &&
          this._artistsMatch(mbRecording, recording.artist_name)) {
        await this._storeMatch(recording.id, mbRecording.id, 'exact');
        return mbRecording.id;
      }
    }

    // 2. Fuzzy match
    for (const mbRecording of exactMatches) {
      const titleScore = this._similarity(mbRecording.title, recording.title);
      const artistScore = this._bestArtistScore(mbRecording, recording.artist_name);

      if (titleScore >= this.config.fuzzyThreshold && artistScore >= this.config.fuzzyThreshold) {
        await this._storeMatch(recording.id, mbRecording.id, 'fuzzy', titleScore);
        return mbRecording.id;
      }
    }

    return null;
  }

  /**
   * Массовый матчинг записей без MB ID.
   * @param {number} [limit=50]
   * @returns {Promise<{ matched: number, failed: number }>}
   */
  async matchUnmatchedRecordings(limit = 50) {
    const result = await this.pool.query(
      `SELECT r.id, r.title, a.name AS artist_name
       FROM recordings r
       LEFT JOIN artists a ON r.artist_id = a.id
       WHERE r.musicbrainz_recording_id IS NULL
       ORDER BY r.created_at
       LIMIT $1`,
      [limit],
    );

    let matched = 0;
    let failed = 0;

    for (const rec of result.rows) {
      const mbid = await this.matchRecording(rec);
      if (mbid) {matched++;}
      else {failed++;}
    }

    return { matched, failed };
  }

  /**
   * Обновляет musicbrainz_recording_id для записи.
   * @param {string} recordingId
   * @param {string} mbid
   * @param {string} matchType - 'exact' | 'fuzzy'
   * @param {number} [_score]
   */
  async _storeMatch(recordingId, mbid, matchType, _score = 1.0) {
    await this.pool.query(
      `UPDATE recordings SET musicbrainz_recording_id = $1, updated_at = NOW() WHERE id = $2`,
      [mbid, recordingId],
    );
  }

  /**
   * Проверяет точное совпадение названий (case-insensitive).
   */
  _titlesMatch(a, b) {
    return a.toLowerCase().trim() === b.toLowerCase().trim();
  }

  /**
   * Проверяет совпадение артиста в MusicBrainz записи.
   */
  _artistsMatch(mbRecording, localArtistName) {
    if (!mbRecording['artist-credit']) {return false;}
    const local = localArtistName.toLowerCase().trim();
    return mbRecording['artist-credit'].some((ac) =>
      ac.artist?.name?.toLowerCase().trim() === local ||
      ac.name?.toLowerCase().trim() === local,
    );
  }

  /**
   * Лучший скор совпадения артиста.
   */
  _bestArtistScore(mbRecording, localArtistName) {
    if (!mbRecording['artist-credit']) {return 0;}
    const local = localArtistName.toLowerCase().trim();
    let best = 0;
    for (const ac of mbRecording['artist-credit']) {
      const mbName = (ac.artist?.name ?? ac.name ?? '').toLowerCase().trim();
      best = Math.max(best, this._similarity(mbName, local));
    }
    return best;
  }

  /**
   * Levenshtein similarity (0-1).
   */
  _similarity(a, b) {
    if (a === b) {return 1;}
    if (!a || !b) {return 0;}

    const lenA = a.length;
    const lenB = b.length;
    const matrix = Array.from({ length: lenA + 1 }, () => Array(lenB + 1).fill(0));

    for (let i = 0; i <= lenA; i++) { matrix[i][0] = i; }
    for (let j = 0; j <= lenB; j++) { matrix[0][j] = j; }

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost,
        );
      }
    }

    const distance = matrix[lenA][lenB];
    const maxLen = Math.max(lenA, lenB);
    return 1 - distance / maxLen;
  }
}

/**
 * Фабрика для создания matcher'а.
 * @param {Object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {Object} [deps.config]
 * @returns {RecordingMatcher}
 */
export function createRecordingMatcher({ pool, config = {} }) {
  const mbClient = createMusicBrainzClient(config, pool);
  return new RecordingMatcher({ pool, mbClient, config });
}