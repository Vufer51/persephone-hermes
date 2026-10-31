import pino from 'pino';
import { describeConfig, loadConfig } from '../config/index.js';
import { createPool, pingDatabase } from '../db/pool.js';
import { closeRedis, createRedisClient, pingRedis } from '../services/redis.js';
import { createLoggerOptions } from '../utils/logger.js';
import { createShutdownHandler } from '../utils/shutdown.js';
import { buildApp } from './app.js';

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[fatal] ${error.message}`);
  process.exit(1);
}

const logger = pino(createLoggerOptions(config));
logger.info({ config: describeConfig(config) }, 'запуск API');

const pool = createPool({
  url: config.database.url,
  max: config.database.poolMax,
  logger,
  applicationName: 'persephone-api',
});
const redis = createRedisClient(config.redis.url, { logger });

const app = buildApp({
  config,
  database: { ping: () => pingDatabase(pool) },
  redis: { ping: () => pingRedis(redis) },
});

const shutdown = createShutdownHandler({
  logger: app.log,
  steps: [
    () => app.close(),
    () => closeRedis(redis),
    () => pool.end(),
  ],
});

process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.once('SIGINT', () => {
  void shutdown('SIGINT');
});

try {
  await app.listen({ host: config.http.host, port: config.http.port });
} catch (error) {
  app.log.error({ err: error }, 'не удалось запустить API');
  await app.close().catch(() => {});
  await closeRedis(redis);
  await pool.end().catch(() => {});
  process.exit(1);
}
