import { Buffer } from 'node:buffer';

export const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
export const TEST_SESSION_SECRET = 'test-session-secret-value-32-chars-min';

/**
 * Валидное окружение для тестов конфигурации.
 * @param {Record<string, string | undefined>} overrides
 */
export function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://persephone:secret@127.0.0.1:5432/persephone',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
    SESSION_SECRET: TEST_SESSION_SECRET,
    SECRET_ENCRYPTION_KEY: TEST_ENCRYPTION_KEY,
    ...overrides,
  };
}
