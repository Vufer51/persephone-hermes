#!/usr/bin/env node
/**
 * setup-project.js — Единая точка входа для первоначальной настройки проекта.
 *
 * Выполняет:
 *  1. Создаёт .env из .env.example, если absent
 *  2. Генерирует случайные SESSION_SECRET и SECRET_ENCRYPTION_KEY
 *  3. Запускает docker compose (если контейнеры ещё не подняты)
 *  4. Ждёт готовности всех сервисов (healthcheck)
 *  5. Генерирует API-ключи для Prowlarr и Lidarr через их Web API
 *  6. Вызывает scripts/setup-arr-stack.js для связки сервисов
 *  7. Применяет миграции БД
 *
 * Использование:
 *   npm run setup
 *
 * После завершения проекта достаточно открыть http://127.0.0.1:3000
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(__dirname);
const ROOT_DIR = resolve(APP_DIR, '..');
const ENV_EXAMPLE = resolve(ROOT_DIR, '.env.example');
const ENV_FILE = resolve(ROOT_DIR, '.env');

// ============================================================================
// Вспомогательные функции
// ============================================================================

function log(msg) {
  console.log(`[setup] ${msg}`);
}

function error(msg) {
  console.error(`[setup] ❌ ${msg}`);
  process.exit(1);
}

function run(cmd, opts = {}) {
  log(`$ ${cmd}`);
  execSync(cmd, {
    stdio: 'inherit',
    cwd: opts.cwd ?? ROOT_DIR,
    env: { ...process.env, ...opts.env },
    timeout: opts.timeout ?? 300000,
  });
}

function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Генерирует случайный секрет в base64.
 */
function generateSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64');
}

// ============================================================================
// Шаг 1: .env
// ============================================================================

function ensureEnvFile() {
  if (existsSync(ENV_FILE)) {
    log('.env уже существует, пропускаю создание');
    return;
  }

  if (!existsSync(ENV_EXAMPLE)) {
    error(`Не найден ${ENV_EXAMPLE}`);
  }

  const example = readFileSync(ENV_EXAMPLE, 'utf8');
  const env = example
    .replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${generateSecret(48)}`)
    .replace(/^SECRET_ENCRYPTION_KEY=.*$/m, `SECRET_ENCRYPTION_KEY=${generateSecret(32)}`)
    .replace(/^POSTGRES_PASSWORD=.*$/m, `POSTGRES_PASSWORD=${generateSecret(16)}`);

  writeFileSync(ENV_FILE, env);
  log('.env создан из .env.example (заполнены SESSION_SECRET, SECRET_ENCRYPTION_KEY, POSTGRES_PASSWORD)');
}

// ============================================================================
// Шаг 2: Docker Compose
// ============================================================================

async function ensureDockerCompose() {
  log('Проверяю docker compose...');
  try {
    run('docker compose version', { cwd: ROOT_DIR });
  } catch {
    error('Docker Compose не найден. Установите Docker и docker compose.');
  }

  log('Запускаю docker compose up -d...');
  run('docker compose up -d', { cwd: ROOT_DIR });

  log('Ожидаю готовности сервисов...');
  for (let i = 0; i < 60; i++) {
    try {
      const result = execSync(
        'docker compose ps --format json',
        { cwd: ROOT_DIR, encoding: 'utf8' }
      );
      const services = result.trim().split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);

      const unhealthy = services.filter((s) => s.Health !== 'healthy');
      if (unhealthy.length === 0 && services.length > 0) {
        log('Все сервисы здоровы');
        return;
      }
    } catch {
      // ignore parse errors, keep waiting
    }

    if (i % 5 === 0) {
      log(`  жду сервисы... (${i * 5}с)`);
    }
    await sleep(5);
  }

  error('Не все сервисы стали здоровы за 5 минут. Проверьте `docker compose logs`.');
}

// ============================================================================
// Шаг 3: API-ключи Prowlarr / Lidarr
// ============================================================================



/**
 * Создаёт или возвращает существующий API-ключ Prowlarr.
 * Prowlarr не позволяет создавать ключи через API без уже существующего ключа,
 * поэтому сначала пробуем прочитать из config.xml, затем генерируем через API.
 */
async function ensureProwlarrApiKey() {
  log('Проверяю API-ключ Prowlarr...');

  // Попробуем прочитать ключ из конфигурационного файла контейнера (если доступен)
  // Через API Prowlarr ключ получить нельзя без уже существующего ключа,
  // поэтому предлагаем пользователю ввести его или пропустить настройку Arr-стека.
  const existingKey = process.env.PROWLLARR_API_KEY;
  if (existingKey) {
    log(`  PROWLLARR_API_KEY уже задан в окружении`);
    return existingKey;
  }

  console.log('\n⚠️  PROWLLARR_API_KEY не задан.');
  console.log('   Получите его в Web UI Prowlarr: http://127.0.0.1:9696 → Settings → General → API Key');
  console.log('   И экспортируйте: export PROWLLARR_API_KEY=<ключ>');
  console.log('   Либо пропустите настройку Arr-стека и настройте вручную позже.\n');

  return null;
}

/**
 * Создаёт API-ключ Lidarr через API (требует существующий ключ для аутентификации,
 * но первый ключ можно получить только через Web UI).
 */
async function ensureLidarrApiKey() {
  log('Проверяю API-ключ Lidarr...');

  const existingKey = process.env.LIDARR_API_KEY;
  if (existingKey) {
    log(`  LIDARR_API_KEY уже задан в окружении`);
    return existingKey;
  }

  console.log('\n⚠️  LIDARR_API_KEY не задан.');
  console.log('   Получите его в Web UI Lidarr: http://127.0.0.1:8686 → Settings → General → API Key');
  console.log('   И экспортируйте: export LIDARR_API_KEY=<ключ>\n');

  return null;
}

// ============================================================================
// Шаг 4: Arr-стек
// ============================================================================

async function setupArrStack(prowlarrKey, lidarrKey) {
  if (!prowlarrKey || !lidarrKey) {
    log('Пропускаю настройку Arr-стека (нет API-ключей). Настройте вручную через Web UI.');
    return;
  }

  log('Настраиваю Arr-стек (qBittorrent + Prowlarr + Lidarr)...');
  const env = {
    ...process.env,
    PROWLLARR_API_KEY: prowlarrKey,
    LIDARR_API_KEY: lidarrKey,
  };
  run('node scripts/setup-arr-stack.js', { cwd: APP_DIR, env });
}

// ============================================================================
// Шаг 5: Миграции
// ============================================================================

async function runMigrations() {
  log('Применяю миграции базы данных...');
  run('npm run migrate', { cwd: APP_DIR });
  log('Миграции применены');
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('🚀 Первоначальная настройка Persephone Music\n');

  ensureEnvFile();
  await ensureDockerCompose();

  const prowlarrKey = await ensureProwlarrApiKey();
  const lidarrKey = await ensureLidarrApiKey();

  await setupArrStack(prowlarrKey, lidarrKey);
  await runMigrations();

  console.log('\n✅ Настройка завершена!');
  console.log('\nСледующие шаги:');
  console.log('  1. Откройте http://127.0.0.1:3000 — API готов');
  console.log('  2. Prowlarr: http://127.0.0.1:9696 — добавьте индексаторы (трекеры)');
  console.log('  3. Lidarr: http://127.0.0.1:8686 — добавьте артистов для скачивания');
  console.log('  4. qBittorrent: http://127.0.0.1:8080 — проверьте очередь скачиваний');
  console.log('\nЛоги: docker compose logs -f');
}

main().catch((err) => {
  console.error('\n❌ Настройка прервана:');
  console.error(err);
  process.exit(1);
});