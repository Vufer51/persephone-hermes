import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicBrainzClient } from '../src/modules/library/musicbrainz-client.js';
import { RecordingMatcher, createRecordingMatcher } from '../src/modules/library/recording-matcher.js';

describe('MusicBrainzClient', () => {
  let client;

  beforeEach(() => {
    client = new MusicBrainzClient({
      userAgent: 'TestAgent/1.0',
      rateLimitMs: 10,
    });
  });

  it('должен создавать клиент с корректными параметрами', () => {
    expect(client.baseUrl).toBe('https://musicbrainz.org/ws/2/');
    expect(client.userAgent).toBe('TestAgent/1.0');
    expect(client.rateLimitMs).toBe(10);
  });

  it('должен форматировать URL с параметрами', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn(async (url) => {
      expect(url).toContain('recording/test-mbid');
      expect(url).toContain('fmt=json');
      return { ok: true, json: async () => ({ id: 'test-mbid', title: 'Test' }) };
    });

    const result = await client.lookupRecording('test-mbid');
    expect(result).toEqual({ id: 'test-mbid', title: 'Test' });

    global.fetch = originalFetch;
  });

  it('должен возвращать null при 404', async () => {
    global.fetch = vi.fn(async () => ({ ok: false, status: 404 }));

    const result = await client.lookupRecording('nonexistent');
    expect(result).toBeNull();

    global.fetch = undefined;
  });

  it('должен возвращать null при сетевой ошибке (graceful degradation)', async () => {
    global.fetch = vi.fn(async () => { throw new Error('Network error'); });

    const result = await client.lookupRecording('test');
    expect(result).toBeNull();

    global.fetch = undefined;
  });

  it('должен соблюдать rate limit между запросами', async () => {
    const start = Date.now();
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));

    await client.request('test1');
    await client.request('test2');

    const elapsed = Date.now() - start;
    // 2 запроса с rateLimitMs=10 должны занять минимум 10ms
    expect(elapsed).toBeGreaterThanOrEqual(10);

    global.fetch = undefined;
  });

  it('searchRecording должен возвращать массив записей', async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recordings: [{ id: 'r1' }, { id: 'r2' }] }),
    }));

    const result = await client.searchRecording('Artist', 'Title');
    expect(result).toHaveLength(2);

    global.fetch = undefined;
  });
});

describe('RecordingMatcher', () => {
  let mockPool;
  let mockMbClient;
  let matcher;

  beforeEach(() => {
    mockPool = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    mockMbClient = {
      searchRecording: vi.fn(async () => []),
    };
    matcher = new RecordingMatcher({
      pool: mockPool,
      mbClient: mockMbClient,
      config: { fuzzyThreshold: 0.85 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('должен возвращать null если нет mbClient', async () => {
    const noClientMatcher = new RecordingMatcher({ pool: mockPool, mbClient: null });
    const result = await noClientMatcher.matchRecording({
      id: 'rec1', title: 'Test', artist_name: 'Artist',
    });
    expect(result).toBeNull();
  });

  it('должен находить exact match по title и artist', async () => {
    mockMbClient.searchRecording.mockResolvedValue([
      { id: 'mbid1', title: 'Test Song', 'artist-credit': [{ artist: { name: 'Test Artist' } }] },
    ]);

    const result = await matcher.matchRecording({
      id: 'rec1', title: 'Test Song', artist_name: 'Test Artist',
    });

    expect(result).toBe('mbid1');
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE recordings'),
      ['mbid1', 'rec1'],
    );
  });

  it('должен пропускать несовпадающие артисты при exact match', async () => {
    mockMbClient.searchRecording.mockResolvedValue([
      { id: 'mbid1', title: 'Test Song', 'artist-credit': [{ artist: { name: 'Other Artist' } }] },
    ]);

    const result = await matcher.matchRecording({
      id: 'rec1', title: 'Test Song', artist_name: 'Test Artist',
    });

    expect(result).toBeNull();
  });

  it('должен использовать fuzzy matching при неточном совпадении', async () => {
    mockMbClient.searchRecording.mockResolvedValue([
      { id: 'mbid1', title: 'Test Songg', 'artist-credit': [{ artist: { name: 'Test Artist' } }] },
    ]);

    const result = await matcher.matchRecording({
      id: 'rec1', title: 'Test Song', artist_name: 'Test Artist',
    });

    expect(result).toBe('mbid1');
  });

  it('должен отклонять fuzzy match ниже порога', async () => {
    mockMbClient.searchRecording.mockResolvedValue([
      { id: 'mbid1', title: 'Completely Different', 'artist-credit': [{ artist: { name: 'Test Artist' } }] },
    ]);

    const result = await matcher.matchRecording({
      id: 'rec1', title: 'Test Song', artist_name: 'Test Artist',
    });

    expect(result).toBeNull();
  });

  it('_similarity должен возвращать 1 для идентичных строк', () => {
    expect(matcher._similarity('test', 'test')).toBe(1);
    expect(matcher._similarity('', '')).toBe(1);
  });

  it('_similarity должен возвращать 0 для совершенно разных строк', () => {
    expect(matcher._similarity('abc', 'xyz')).toBeLessThan(0.5);
  });

  it('_similarity должен быть симметричным', () => {
    const a = 'test song';
    const b = 'test songg';
    expect(matcher._similarity(a, b)).toBe(matcher._similarity(b, a));
  });

  it('createRecordingMatcher должен создавать экземпляр с клиентом', () => {
    const config = { version: '1.0', musicbrainzContact: 'test@test.com' };
    const m = createRecordingMatcher({ pool: mockPool, config });
    expect(m).toBeInstanceOf(RecordingMatcher);
    expect(m.mbClient).toBeInstanceOf(MusicBrainzClient);
  });
});