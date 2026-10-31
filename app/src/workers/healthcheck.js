import { loadRedisConfig } from '../config/index.js';
import { createRedisClient } from '../services/redis.js';
import { WORKER_HEARTBEAT_KEY } from './heartbeat.js';

let config;
try {
  config = loadRedisConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const redis = createRedisClient(config.url, {
  logger: null,
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
});

try {
  const heartbeat = await redis.get(WORKER_HEARTBEAT_KEY);
  if (heartbeat) {
    console.log('Worker heartbeat найден.');
  } else {
    console.error('Worker heartbeat отсутствует: Worker не готов.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`Не удалось проверить heartbeat Worker: ${error.message}`);
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
