/**
 * Создаёт обработчик корректного завершения процесса.
 * Повторные сигналы игнорируются: завершение выполняется один раз.
 *
 * @param {{
 *   logger: { info: Function, error: Function },
 *   steps: Array<() => Promise<unknown> | unknown>,
 *   timeoutMs?: number,
 *   exit?: (code: number) => void,
 * }} options
 */
export function createShutdownHandler({ logger, steps, timeoutMs = 10000, exit = (code) => process.exit(code) }) {
  let started = false;

  return async function shutdown(signal) {
    if (started) {
      logger.info({ signal }, 'повторный сигнал завершения проигнорирован');
      return;
    }
    started = true;
    logger.info({ signal }, 'начато корректное завершение');

    const timer = setTimeout(() => {
      logger.error({ signal, timeoutMs }, 'корректное завершение не уложилось в таймаут');
      exit(1);
    }, timeoutMs);
    timer.unref?.();

    try {
      for (const step of steps) {
        await step();
      }
      clearTimeout(timer);
      logger.info('корректное завершение выполнено');
      exit(0);
    } catch (error) {
      clearTimeout(timer);
      logger.error({ err: error }, 'ошибка при корректном завершении');
      exit(1);
    }
  };
}
