import { hostname } from 'node:os';
import { Worker } from 'bullmq';
import pino from 'pino';
import { loadConfig } from '../config/index.js';
import { closeRedis, createRedisClient } from '../services/redis.js';
import { createLoggerOptions } from '../utils/logger.js';
import { createShutdownHandler } from '../utils/shutdown.js';
import { startHeartbeat } from './heartbeat.js';
import { createJobProcessor, QUEUE_NAME } from './processor-registry.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
}

const logger = pino(createLoggerOptions(config));
const workerId = `${hostname()}:${process.pid}`;

// BullMQ требует maxRetriesPerRequest: null и не должен обрывать блокирующие команды.
const redis = createRedisClient(config.redis.url, {
  logger,
  maxRetriesPerRequest: null,
  commandTimeout: null,
});

const worker = new Worker(QUEUE_NAME, createJobProcessor({}), {
  connection: redis,
  concurrency: 1,
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, jobName: job.name }, 'задача завершена');
});
worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, jobName: job?.name, err: error }, 'задача завершилась ошибкой');
});
worker.on('error', (error) => {
  logger.error({ err: error }, 'ошибка Worker');
});

// Heartbeat использует отдельное соединение: блокирующие команды BullMQ не должны
// задерживать обновление ключа готовности.
const heartbeatRedis = createRedisClient(config.redis.url, {
  logger,
  maxRetriesPerRequest: 1,
  commandTimeout: 3000,
});

const stopHeartbeat = startHeartbeat({ redis: heartbeatRedis, workerId, logger });
logger.info({ workerId, queue: QUEUE_NAME }, 'Worker запущен');

worker
  .waitUntilReady()
  .then(() => {
    logger.info({ workerId }, 'Worker подключён к Redis');
  })
  .catch((error) => {
    logger.error({ err: error }, 'Worker не смог подключиться к Redis');
  });

const shutdown = createShutdownHandler({
  logger,
  steps: [
    () => worker.close(),
    () => stopHeartbeat(),
    () => closeRedis(heartbeatRedis),
    () => closeRedis(redis),
  ],
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
