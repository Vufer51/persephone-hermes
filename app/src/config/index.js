import { Buffer } from 'node:buffer';

const ENVIRONMENTS = new Set(['development', 'test', 'production']);
const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']);
const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);
const REDIS_PROTOCOLS = new Set(['redis:', 'rediss:']);
const HTTP_PROTOCOLS = new Set(['http:', 'https:']);
const ENCRYPTION_KEY_BYTES = 32;
const MIN_SESSION_SECRET_LENGTH = 32;

export class ConfigError extends Error {
  /**
   * @param {string[]} issues
   */
  constructor(issues) {
    const message = [
      'Некорректная конфигурация окружения:',
      ...issues.map((issue) => `  - ${issue}`),
    ].join('\n');
    super(message);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

/**
 * Загружает и валидирует конфигурацию из переменных окружения.
 * Сообщения об ошибках содержат только имена переменных, но не их значения.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function loadConfig(env = process.env) {
  const issues = [];
  const values = {};

  values.nodeEnv = readEnum(env, 'NODE_ENV', ENVIRONMENTS, 'development', issues);
  values.logLevel = readEnum(env, 'LOG_LEVEL', LOG_LEVELS, 'info', issues);
  values.isProduction = values.nodeEnv === 'production';
  values.isTest = values.nodeEnv === 'test';

  values.http = {
    host: readString(env, 'API_HOST', { defaultValue: '0.0.0.0', issues }),
    port: readInteger(env, 'API_PORT', { defaultValue: 3000, min: 1, max: 65535, issues }),
  };

  values.webOrigin = readUrl(env, 'WEB_ORIGIN', {
    defaultValue: 'http://localhost:5173',
    protocols: HTTP_PROTOCOLS,
    issues,
  })?.origin ?? null;

  values.database = {
    url: readUrl(env, 'DATABASE_URL', { required: true, protocols: POSTGRES_PROTOCOLS, issues })?.href ?? null,
    poolMax: readInteger(env, 'DATABASE_POOL_MAX', { defaultValue: 10, min: 1, max: 100, issues }),
  };

  values.redis = {
    url: readUrl(env, 'REDIS_URL', { required: true, protocols: REDIS_PROTOCOLS, issues })?.href ?? null,
  };

  const sessionSecret = readString(env, 'SESSION_SECRET', { required: true, issues });
  if (sessionSecret !== null && sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    issues.push(`SESSION_SECRET: требуется не менее ${MIN_SESSION_SECRET_LENGTH} символов`);
  }

  const encryptionKey = readEncryptionKey(env, 'SECRET_ENCRYPTION_KEY', issues);
  const encryptionKeyVersion = readInteger(env, 'SECRET_ENCRYPTION_KEY_VERSION', {
    defaultValue: 1,
    min: 1,
    max: 32767,
    issues,
  });
  const rawEncryptionKey =
    typeof env.SECRET_ENCRYPTION_KEY === 'string' ? env.SECRET_ENCRYPTION_KEY.trim() : '';
  if (sessionSecret !== null && rawEncryptionKey !== '' && sessionSecret === rawEncryptionKey) {
    issues.push('SESSION_SECRET не должен совпадать с SECRET_ENCRYPTION_KEY');
  }

  values.music = {
    rootContainer: readAbsolutePath(env, 'MUSIC_ROOT_CONTAINER', '/music', issues),
    storageRootName: readString(env, 'STORAGE_ROOT_NAME', { defaultValue: 'local-music', issues }),
    storageRootIdentifier: readString(env, 'STORAGE_ROOT_IDENTIFIER', {
      defaultValue: 'local-music',
      issues,
    }),
  };

  values.integrations = {
    navidrome: {
      url: readUrl(env, 'NAVIDROME_URL', {
        defaultValue: 'http://navidrome:4533',
        protocols: HTTP_PROTOCOLS,
        issues,
      })?.href ?? null,
      user: readString(env, 'NAVIDROME_USER', { required: false, issues }),
      password: readString(env, 'NAVIDROME_PASSWORD', { required: false, issues }),
    },
    lidarr: {
      url: readUrl(env, 'LIDARR_URL', {
        defaultValue: 'http://lidarr:8686',
        protocols: HTTP_PROTOCOLS,
        issues,
      })?.href ?? null,
      apiKey: readString(env, 'LIDARR_API_KEY', { required: false, issues }),
    },
    musicbrainz: {
      baseUrl: readUrl(env, 'MUSICBRAINZ_BASE_URL', {
        defaultValue: 'https://musicbrainz.org/ws/2',
        protocols: HTTP_PROTOCOLS,
        issues,
      })?.href ?? null,
      userAgent: readString(env, 'MUSICBRAINZ_USER_AGENT', {
        defaultValue: 'PersephoneMusic/0.1 (+https://github.com/DrRocksoDevelopment/persephone)',
        issues,
      }),
    },
    lastfm: {
      baseUrl: readUrl(env, 'LASTFM_BASE_URL', {
        defaultValue: 'https://ws.audioscrobbler.com/2.0/',
        protocols: HTTP_PROTOCOLS,
        issues,
      })?.href ?? null,
      apiKey: readString(env, 'LASTFM_API_KEY', { required: false, issues }),
      sharedSecret: readString(env, 'LASTFM_SHARED_SECRET', { required: false, issues }),
    },
  };

  const lastfm = values.integrations.lastfm;
  if ((lastfm.apiKey === null) !== (lastfm.sharedSecret === null)) {
    issues.push('LASTFM_API_KEY и LASTFM_SHARED_SECRET должны быть заданы вместе');
  }

  if (issues.length > 0) {
    throw new ConfigError(issues);
  }

  const config = {
    nodeEnv: values.nodeEnv,
    isProduction: values.isProduction,
    isTest: values.isTest,
    logLevel: values.logLevel,
    http: Object.freeze(values.http),
    webOrigin: values.webOrigin,
    database: Object.freeze(values.database),
    redis: Object.freeze(values.redis),
    music: Object.freeze(values.music),
    integrations: deepFreeze(values.integrations),
  };

  // Секреты не перечисляются: случайная сериализация конфигурации не должна их раскрывать.
  Object.defineProperty(config, 'secrets', {
    value: Object.freeze({
      sessionSecret,
      encryptionKey,
      encryptionKeyVersion,
    }),
    enumerable: false,
    writable: false,
    configurable: false,
  });

  return Object.freeze(config);
}

/**
 * Конфигурация только для работы с PostgreSQL (миграции, проверка схемы).
 * Не требует секретов приложения.
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function loadDatabaseConfig(env = process.env) {
  const issues = [];
  const config = {
    url: readUrl(env, 'DATABASE_URL', { required: true, protocols: POSTGRES_PROTOCOLS, issues })?.href ?? null,
    poolMax: readInteger(env, 'DATABASE_POOL_MAX', { defaultValue: 10, min: 1, max: 100, issues }),
  };
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
  return Object.freeze(config);
}

/**
 * Конфигурация только для Redis (healthcheck Worker).
 *
 * @param {NodeJS.ProcessEnv} env
 */
export function loadRedisConfig(env = process.env) {
  const issues = [];
  const config = {
    url: readUrl(env, 'REDIS_URL', { required: true, protocols: REDIS_PROTOCOLS, issues })?.href ?? null,
  };
  if (issues.length > 0) {
    throw new ConfigError(issues);
  }
  return Object.freeze(config);
}

/**
 * Безопасное представление конфигурации для логов и диагностики.
 * @param {ReturnType<typeof loadConfig>} config
 */
export function describeConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    logLevel: config.logLevel,
    http: config.http,
    webOrigin: config.webOrigin,
    database: { poolMax: config.database.poolMax, configured: Boolean(config.database.url) },
    redis: { configured: Boolean(config.redis.url) },
    music: config.music,
    integrations: {
      navidrome: { url: config.integrations.navidrome.url, configured: Boolean(config.integrations.navidrome.user) },
      lidarr: { url: config.integrations.lidarr.url, configured: Boolean(config.integrations.lidarr.apiKey) },
      musicbrainz: config.integrations.musicbrainz,
      lastfm: {
        baseUrl: config.integrations.lastfm.baseUrl,
        configured: Boolean(config.integrations.lastfm.apiKey),
      },
    },
    secrets: {
      sessionSecretConfigured: true,
      encryptionKeyConfigured: true,
      encryptionKeyVersion: config.secrets.encryptionKeyVersion,
    },
  };
}

function readString(env, name, { required = false, defaultValue = null, issues }) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    if (required) {
      issues.push(`${name}: обязательная переменная не задана`);
      return null;
    }
    return defaultValue;
  }
  if (typeof raw !== 'string') {
    issues.push(`${name}: ожидается строка`);
    return defaultValue;
  }
  return raw.trim();
}

function readInteger(env, name, { defaultValue, min, max, issues }) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value)) {
    issues.push(`${name}: ожидается целое число`);
    return defaultValue;
  }
  if (value < min || value > max) {
    issues.push(`${name}: допустимый диапазон ${min}..${max}`);
    return defaultValue;
  }
  return value;
}

function readEnum(env, name, allowed, defaultValue, issues) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    return defaultValue;
  }
  const value = String(raw).trim();
  if (!allowed.has(value)) {
    issues.push(`${name}: допустимые значения: ${[...allowed].join(', ')}`);
    return defaultValue;
  }
  return value;
}

function readUrl(env, name, { required = false, defaultValue = null, protocols, issues }) {
  const raw = readString(env, name, { required, defaultValue, issues });
  if (raw === null) {
    return null;
  }
  let url;
  try {
    url = new URL(raw);
  } catch {
    issues.push(`${name}: некорректный URL`);
    return null;
  }
  if (!protocols.has(url.protocol)) {
    issues.push(`${name}: допустимые протоколы: ${[...protocols].join(', ')}`);
    return null;
  }
  return url;
}

function readAbsolutePath(env, name, defaultValue, issues) {
  const value = readString(env, name, { defaultValue, issues });
  if (!value.startsWith('/')) {
    issues.push(`${name}: ожидается абсолютный путь в контейнере`);
    return defaultValue;
  }
  return value;
}

function readEncryptionKey(env, name, issues) {
  const raw = readString(env, name, { required: true, issues });
  if (raw === null) {
    return null;
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length % 4 !== 0) {
    issues.push(`${name}: ожидается base64-значение (32 байта)`);
    return null;
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    issues.push(`${name}: после декодирования требуется ровно ${ENCRYPTION_KEY_BYTES} байт`);
    return null;
  }
  return key;
}

function deepFreeze(value) {
  for (const key of Object.keys(value)) {
    if (value[key] && typeof value[key] === 'object') {
      deepFreeze(value[key]);
    }
  }
  return Object.freeze(value);
}
