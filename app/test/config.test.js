import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { ConfigError, describeConfig, loadConfig, loadDatabaseConfig, loadRedisConfig } from '../src/config/index.js';
import { TEST_ENCRYPTION_KEY, validEnv } from './helpers/env.js';

describe('loadConfig', () => {
  it('загружает валидную конфигурацию и замораживает её', () => {
    const config = loadConfig(validEnv());

    expect(config.nodeEnv).toBe('test');
    expect(config.http.port).toBe(3000);
    expect(config.database.poolMax).toBe(10);
    expect(config.secrets.encryptionKey).toHaveLength(32);
    expect(config.secrets.encryptionKeyVersion).toBe(1);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.database)).toBe(true);
  });

  it('не раскрывает секреты при сериализации и в describeConfig', () => {
    const config = loadConfig(validEnv());
    const serialized = JSON.stringify(config);
    const described = JSON.stringify(describeConfig(config));

    expect(serialized).not.toContain(TEST_ENCRYPTION_KEY);
    expect(serialized).not.toContain('test-session-secret');
    expect(described).not.toContain(TEST_ENCRYPTION_KEY);
    expect(described).not.toContain('test-session-secret');
    expect(described).toContain('encryptionKeyVersion');
  });

  it('сообщает об отсутствии обязательной переменной', () => {
    const env = validEnv({ DATABASE_URL: '' });

    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/DATABASE_URL/);
  });

  it('проверяет диапазон порта', () => {
    expect(() => loadConfig(validEnv({ API_PORT: '70000' }))).toThrow(/API_PORT/);
    expect(() => loadConfig(validEnv({ API_PORT: 'not-a-number' }))).toThrow(/API_PORT/);
  });

  it('требует достаточно длинный SESSION_SECRET', () => {
    expect(() => loadConfig(validEnv({ SESSION_SECRET: 'too-short' }))).toThrow(/SESSION_SECRET/);
  });

  it('требует ключ шифрования ровно 32 байта в base64', () => {
    expect(() => loadConfig(validEnv({ SECRET_ENCRYPTION_KEY: 'not-base64' }))).toThrow(
      /SECRET_ENCRYPTION_KEY/,
    );
    expect(() =>
      loadConfig(validEnv({ SECRET_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64') })),
    ).toThrow(/32 байт/);
  });

  it('запрещает совпадение SESSION_SECRET и SECRET_ENCRYPTION_KEY', () => {
    const env = validEnv({ SESSION_SECRET: TEST_ENCRYPTION_KEY });

    expect(() => loadConfig(env)).toThrow(/не должен совпадать/);
  });

  it('требует Last.fm ключи вместе', () => {
    expect(() => loadConfig(validEnv({ LASTFM_API_KEY: 'key-only' }))).toThrow(
      /LASTFM_API_KEY и LASTFM_SHARED_SECRET/,
    );
  });

  it('не включает значения секретов в текст ошибки', () => {
    const secret = 'corrupted-secret-value-that-must-not-leak';
    let message = '';
    try {
      loadConfig(validEnv({ SECRET_ENCRYPTION_KEY: secret }));
    } catch (error) {
      message = error.message;
    }

    expect(message).toContain('SECRET_ENCRYPTION_KEY');
    expect(message).not.toContain(secret);
  });
});

describe('loadDatabaseConfig', () => {
  it('не требует секретов приложения', () => {
    const config = loadDatabaseConfig({ DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' });

    expect(config.url).toContain('postgresql://');
    expect(config.poolMax).toBe(10);
  });

  it('проверяет протокол', () => {
    expect(() => loadDatabaseConfig({ DATABASE_URL: 'http://localhost/db' })).toThrow(/протоколы/);
  });
});

describe('loadRedisConfig', () => {
  it('принимает redis и rediss', () => {
    expect(loadRedisConfig({ REDIS_URL: 'redis://localhost:6379' }).url).toContain('redis://');
    expect(loadRedisConfig({ REDIS_URL: 'rediss://localhost:6379' }).url).toContain('rediss://');
  });

  it('требует REDIS_URL', () => {
    expect(() => loadRedisConfig({})).toThrow(/REDIS_URL/);
  });
});
