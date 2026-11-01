import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/api/app.js';
import { validateEmail, validatePassword, validateUsername } from '../src/modules/auth/registration.js';
import { hashPassword, verifyPassword, generateToken, hashToken } from '../src/modules/auth/crypto.js';

/** @type {Array<import('fastify').FastifyInstance>} */
const apps = [];

function createApp(overrides = {}) {
  const mockPool = {
    query: vi.fn(async () => ({ rows: [] })),
  };
  const mockDatabase = { pool: mockPool, ping: vi.fn(async () => {}) };
  const mockRedis = { ping: vi.fn(async () => {}), setex: vi.fn(), del: vi.fn(), get: vi.fn() };

  const app = buildApp({
    config: {
      nodeEnv: 'test',
      isProduction: false,
      isTest: true,
      logLevel: 'silent',
      http: { host: '127.0.0.1', port: 0 },
      webOrigin: null,
      database: { url: 'postgres://test', poolMax: 10 },
      redis: { url: 'redis://test' },
      music: { rootContainer: '/music', storageRootName: 'test', storageRootIdentifier: 'test' },
      integrations: { navidrome: {}, lidarr: {}, musicbrainz: {}, lastfm: {} },
      auth: { sessionTtlDays: 7 },
    },
    database: mockDatabase,
    redis: mockRedis,
    logger: false,
    ...overrides,
  });
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  vi.restoreAllMocks();
});

describe('auth registration validators', () => {
  describe('validateEmail', () => {
    it('возвращает ошибку для пустого email', () => {
      const result = validateEmail('');
      expect(result.valid).toBe(false);
    });

    it('возвращает ошибку для некорректного email', () => {
      const result = validateEmail('not-an-email');
      expect(result.valid).toBe(false);
    });

    it('принимает валидный email', () => {
      const result = validateEmail('test@example.com');
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePassword', () => {
    it('возвращает ошибку для короткого пароля', () => {
      const result = validatePassword('short');
      expect(result.valid).toBe(false);
    });

    it('принимает пароль минимум 8 символов', () => {
      const result = validatePassword('12345678');
      expect(result.valid).toBe(true);
    });
  });

  describe('validateUsername', () => {
    it('возвращает ошибку для слишком короткого username', () => {
      const result = validateUsername('ab');
      expect(result.valid).toBe(false);
    });

    it('возвращает ошибку для username со спецсимволами', () => {
      const result = validateUsername('user@name');
      expect(result.valid).toBe(false);
    });

    it('принимает валидный username', () => {
      const result = validateUsername('user_name123');
      expect(result.valid).toBe(true);
    });
  });
});

describe('auth crypto', () => {
  it('хэширует и верифицирует пароль', async () => {
    const password = 'test_password_123';
    const hash = await hashPassword(password);
    expect(typeof hash).toBe('string');

    const valid = await verifyPassword(password, hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('wrong_password', hash);
    expect(invalid).toBe(false);
  });

  it('генерирует уникальный токен', () => {
    const token1 = generateToken();
    const token2 = generateToken();
    expect(token1).not.toBe(token2);
    expect(token1).toHaveLength(44);
  });

  it('хеширует токен детерминировано', () => {
    const token = 'test_token';
    const hash1 = hashToken(token);
    const hash2 = hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });
});

describe('auth registration routes', () => {
  it('возвращает 422 для невалидного email', async () => {
    const app = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', password: 'testpassword123' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('возвращает 422 для короткого пароля', async () => {
    const app = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@example.com', password: 'short' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('validation_error');
  });

  it('возвращает 409 для дублирующегося email', async () => {
    const app = createApp();
    app.dependencies.database.pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT * FROM users WHERE email')) {
        return { rows: [{ id: 'existing', email: 'test@example.com' }] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@example.com', password: 'testpassword123' },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('email_already_exists');
  });

  it('возвращает 201 для успешной регистрации', async () => {
    const app = createApp();
    app.dependencies.database.pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT * FROM users WHERE email')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO users')) {
        return { rows: [{ id: 'new-user', email: 'test@example.com', username: 'testuser', role: 'user', status: 'active', created_at: new Date().toISOString() }] };
      }
      if (sql.includes('INSERT INTO user_sessions')) {
        return { rows: [{ id: 'session-1', token_hash: 'abc', user_id: 'new-user', expires_at: new Date().toISOString() }] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'test@example.com', password: 'testpassword123', username: 'testuser' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.user.email).toBe('test@example.com');
    expect(body.user.username).toBe('testuser');
    expect(body.session.token).toBeDefined();
  });
});

describe('auth login routes', () => {
  it('возвращает 401 для несуществующего пользователя', async () => {
    const app = createApp();
    app.dependencies.database.pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT * FROM users WHERE email')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'test@example.com', password: 'testpassword123' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });

  it('возвращает 401 для неправильного пароля', async () => {
    const { hashPassword } = await import('../src/modules/auth/crypto.js');
    const correctPassword = 'correctpassword123';
    const validHash = await hashPassword(correctPassword);

    const app = createApp();
    app.dependencies.database.pool.query = vi.fn(async (sql, values) => {
      if (sql.includes('SELECT * FROM users WHERE email')) {
        return { rows: [{ id: 'user-1', email: values[0], password_hash: validHash, username: 'testuser', role: 'user', status: 'active', created_at: new Date().toISOString(), last_login_at: null }] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'test@example.com', password: 'wrongpassword' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('invalid_credentials');
  });
});

describe('auth me route', () => {
  it('возвращает 401 без токена авторизации', async () => {
    const app = createApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
    });
    expect(response.statusCode).toBe(401);
  });

  it('возвращает 401 с невалидным токеном', async () => {
    const app = createApp();
    app.dependencies.database.pool.query = vi.fn(async (sql) => {
      if (sql.includes('SELECT s.id AS session_id')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer invalid_token' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('auth logout route', () => {
  it('возвращает 401 без токена авторизации', async () => {
    const app = createApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
    });
    expect(response.statusCode).toBe(401);
  });
});
