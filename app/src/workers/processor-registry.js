import { createScrobbleProcessor } from './processors/scrobble-processor.js';

export const QUEUE_NAME = 'persephone';

/**
 * Создаёт диспетчер задач BullMQ (для обратной совместимости).
 * @param {Record<string, (job: import('bullmq').Job) => Promise<unknown>>} processors
 */
export function createJobProcessor(processors) {
  return async function processJob(job) {
    const processor = processors[job.name];
    if (!processor) {
      throw new Error(`Для задачи "${job.name}" не зарегистрирован процессор`);
    }
    return processor(job);
  };
}

/**
 * Реестр процессоров Worker.
 * Управляет жизненным циклом: запуск, остановка, healthcheck.
 */
export class ProcessorRegistry {
  /**
   * @param {Object} deps
   * @param {import('pg').Pool} deps.pool
   * @param {Object} deps.config
   * @param {Object} deps.cryptoService
   */
  constructor({ pool, config, cryptoService }) {
    this.pool = pool;
    this.config = config;
    this.cryptoService = cryptoService;
    this.processors = new Map();
    this.started = false;
  }

  /**
   * Регистрирует и запускает все процессоры.
   */
  async start() {
    if (this.started) {return;}

    // Ленивая загрузка Last.fm клиента
    const { createLastFmClient } = await import('../../integrations/lastfm-client.js');
    const lastfmClient = createLastFmClient(this.config);

    // Scrobble Processor
    const scrobbleProcessor = createScrobbleProcessor({
      pool: this.pool,
      config: this.config,
      cryptoService: this.cryptoService,
      lastfmClient,
      pollIntervalMs: this.config.scrobblePollIntervalMs ?? 30000,
      maxConcurrent: this.config.scrobbleMaxConcurrent ?? 5,
    });

    this.processors.set('scrobble', scrobbleProcessor);
    scrobbleProcessor.start();

    this.started = true;
    console.log('Worker processors started:', [...this.processors.keys()].join(', '));
  }

  /**
   * Graceful shutdown всех процессоров.
   */
  async stop() {
    if (!this.started) {return;}

    await Promise.all(
      [...this.processors.values()].map((p) => p.stop()),
    );
    this.processors.clear();
    this.started = false;
    console.log('Worker processors stopped');
  }

  /**
   * Возвращает статус всех процессоров.
   */
  getStatus() {
    const status = {};
    for (const [name, processor] of this.processors) {
      status[name] = processor.getStatus();
    }
    return status;
  }

  /**
   * Проверяет, что все процессоры работают.
   */
  isHealthy() {
    return this.started && this.processors.size > 0;
  }
}

/**
 * Фабрика для создания реестра процессоров.
 * @param {Object} deps
 * @returns {ProcessorRegistry}
 */
export function createProcessorRegistry(deps) {
  return new ProcessorRegistry(deps);
}