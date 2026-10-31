export const QUEUE_NAME = 'persephone';

/**
 * Создаёт диспетчер задач BullMQ.
 * В Stage 0 процессоры не регистрируются: неизвестная задача завершается ошибкой,
 * а не фиктивным успехом.
 *
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
