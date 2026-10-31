import { describe, expect, it, vi } from 'vitest';
import { startHeartbeat, WORKER_HEARTBEAT_KEY } from '../src/workers/heartbeat.js';
import { createJobProcessor } from '../src/workers/processor-registry.js';

describe('createJobProcessor', () => {
  it('вызывает зарегистрированный процессор', async () => {
    const job = { name: 'known', data: { value: 1 } };
    const processor = vi.fn(async () => 'result');
    const processJob = createJobProcessor({ known: processor });

    await expect(processJob(job)).resolves.toBe('result');
    expect(processor).toHaveBeenCalledWith(job);
  });

  it('завершает неизвестную задачу ошибкой, а не фиктивным успехом', async () => {
    const processJob = createJobProcessor({});

    await expect(processJob({ name: 'unknown' })).rejects.toThrow(/не зарегистрирован/);
  });
});

describe('startHeartbeat', () => {
  it('публикует ключ с TTL и удаляет его при остановке', async () => {
    const values = new Map();
    const redis = {
      set: vi.fn(async (key, value, mode, ttl) => {
        values.set(key, { value, ttl, mode });
      }),
      get: vi.fn(async (key) => values.get(key)?.value ?? null),
      del: vi.fn(async (key) => {
        values.delete(key);
      }),
    };

    const stop = startHeartbeat({
      redis,
      workerId: 'test-worker',
      intervalMs: 60000,
      ttlSeconds: 30,
    });

    await vi.waitFor(() => {
      expect(redis.set).toHaveBeenCalled();
    });

    const [key, value, mode, ttl] = redis.set.mock.calls[0];
    expect(key).toBe(WORKER_HEARTBEAT_KEY);
    expect(value).toMatch(/^test-worker:\d+$/);
    expect(mode).toBe('EX');
    expect(ttl).toBe(30);

    await stop();

    expect(redis.del).toHaveBeenCalledWith(WORKER_HEARTBEAT_KEY);
    expect(values.size).toBe(0);
  });

  it('не удаляет чужой heartbeat', async () => {
    const redis = {
      set: vi.fn(async () => 'OK'),
      get: vi.fn(async () => 'another-worker:1'),
      del: vi.fn(async () => 1),
    };

    const stop = startHeartbeat({ redis, workerId: 'test-worker', intervalMs: 60000 });
    await stop();

    expect(redis.del).not.toHaveBeenCalled();
  });
});
