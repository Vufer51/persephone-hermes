export const WORKER_HEARTBEAT_KEY = 'persephone:worker:heartbeat';

/**
 * Публикует heartbeat Worker в Redis с TTL.
 * Используется Docker healthcheck, чтобы отличать живой процесс от зависшего.
 *
 * @param {{
 *   redis: import('ioredis').Redis,
 *   workerId: string,
 *   intervalMs?: number,
 *   ttlSeconds?: number,
 *   logger?: { warn: Function },
 * }} options
 * @returns {() => Promise<void>}
 */
export function startHeartbeat({ redis, workerId, intervalMs = 10000, ttlSeconds = 30, logger }) {
  const value = `${workerId}:${Date.now()}`;
  let stopped = false;

  const write = async () => {
    if (stopped) {
      return;
    }
    try {
      await redis.set(WORKER_HEARTBEAT_KEY, value, 'EX', ttlSeconds);
    } catch (error) {
      logger?.warn({ err: error }, 'не удалось обновить heartbeat Worker');
    }
  };

  void write();
  const timer = setInterval(() => {
    void write();
  }, intervalMs);
  timer.unref?.();

  return async function stopHeartbeat() {
    stopped = true;
    clearInterval(timer);
    try {
      const current = await redis.get(WORKER_HEARTBEAT_KEY);
      if (current === value) {
        await redis.del(WORKER_HEARTBEAT_KEY);
      }
    } catch {
      // Удаление heartbeat не должно мешать завершению процесса.
    }
  };
}
