import { withTimeout } from '../../utils/timeout.js';

const CHECK_TIMEOUT_MS = 2000;

/**
 * Регистрирует health-маршруты. Они не содержат бизнес-логики и не обращаются
 * к данным приложения.
 *
 * @param {import('fastify').FastifyInstance} app
 * @param {{
 *   database: { ping: () => Promise<void> },
 *   redis: { ping: () => Promise<void> },
 * }} dependencies
 */
export function registerHealthRoutes(app, dependencies) {
  app.get('/api/v1/health/live', async () => ({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  }));

  app.get('/api/v1/health/ready', async (request, reply) => {
    const checks = await runChecks(request, dependencies);
    const ready = Object.values(checks).every((status) => status === 'ok');

    if (!ready) {
      reply.code(503);
    }

    return {
      status: ready ? 'ready' : 'unavailable',
      checks,
      timestamp: new Date().toISOString(),
    };
  });
}

async function runChecks(request, dependencies) {
  const results = await Promise.allSettled([
    check(request, 'postgres', () => dependencies.database.ping()),
    check(request, 'redis', () => dependencies.redis.ping()),
  ]);

  const checks = {};
  const names = ['postgres', 'redis'];
  results.forEach((result, index) => {
    checks[names[index]] = result.status === 'fulfilled' && result.value === true ? 'ok' : 'error';
  });
  return checks;
}

async function check(request, name, run) {
  try {
    await withTimeout(Promise.resolve().then(run), CHECK_TIMEOUT_MS, `проверка ${name}`);
    return true;
  } catch (error) {
    request.log.warn({ err: error, check: name }, 'readiness-проверка не пройдена');
    return false;
  }
}
