#!/usr/bin/env node
/**
 * setup-arr-stack.js — Автоматическая предварительная настройка Arr-стека.
 *
 * Настраивает qBittorrent, Prowlarr и Lidarr через их REST API так, чтобы
 * Lidarr мог скачивать релизы через qBittorrent и индексировать их через Prowlarr.
 *
 * Требования:
 *   - Все контейнеры запущены (`docker compose up -d`)
 *   - API-ключи Prowlarr и Lidarr известны (берутся из их Web UI: Settings -> General)
 *   - qBittorrent доступен с логином/паролем (по умолчанию admin/adminadmin)
 *
 * Переменные окружения:
 *   PROWLLARR_URL           URL Prowlarr (по умолчанию http://127.0.0.1:9696)
 *   PROWLLARR_API_KEY       API-ключ Prowlarr (обязателен)
 *   LIDARR_URL              URL Lidarr (по умолчанию http://127.0.0.1:8686)
 *   LIDARR_API_KEY          API-ключ Lidarr (обязателен)
 *   QBITTORRENT_URL         URL qBittorrent (по умолчанию http://127.0.0.1:8080)
 *   QBITTORRENT_USERNAME    Логин qBittorrent (по умолчанию admin)
 *   QBITTORRENT_PASSWORD    Пароль qBittorrent (по умолчанию adminadmin)
 *   RETRY_COUNT             Количество попыток подключения (по умолчанию 30)
 *   RETRY_DELAY             Задержка между попытками в секундах (по умолчанию 5)
 *
 * Использование:
 *   PROWLLARR_API_KEY=xxx LIDARR_API_KEY=yyy node scripts/setup-arr-stack.js
 */


// ============================================================================
// Конфигурация
// ============================================================================

const PROWLLARR_URL = process.env.PROWLLARR_URL ?? 'http://127.0.0.1:9696';
const PROWLLARR_API_KEY = process.env.PROWLLARR_API_KEY;
const LIDARR_URL = process.env.LIDARR_URL ?? 'http://127.0.0.1:8686';
const LIDARR_API_KEY = process.env.LIDARR_API_KEY;
const QBITTORRENT_URL = process.env.QBITTORRENT_URL ?? 'http://127.0.0.1:8080';
const QBITTORRENT_USERNAME = process.env.QBITTORRENT_USERNAME ?? 'admin';
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD ?? 'adminadmin';
const RETRY_COUNT = parseInt(process.env.RETRY_COUNT ?? '30', 10);
const RETRY_DELAY = parseInt(process.env.RETRY_DELAY ?? '5', 10);

if (!PROWLLARR_API_KEY) {
  console.error('ОШИБКА: Не задан PROWLLARR_API_KEY');
  console.error('Получите его в Web UI Prowlarr: Settings -> General -> API Key');
  process.exit(1);
}

if (!LIDARR_API_KEY) {
  console.error('ОШИБКА: Не задан LIDARR_API_KEY');
  console.error('Получите его в Web UI Lidarr: Settings -> General -> API Key');
  process.exit(1);
}

// ============================================================================
// Вспомогательные функции
// ============================================================================

/**
 * Ждёт указанное количество секунд.
 */
async function sleep(seconds) {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

/**
 * Делает HTTP-запрос с повторными попытками.
 */
async function fetchWithRetry(url, options, attempt = 1) {
  try {
    const response = await fetch(url, options);
    return response;
  } catch (err) {
    if (attempt >= RETRY_COUNT) {
      throw err;
    }
    console.log(`  ${url} недоступен, попытка ${attempt}/${RETRY_COUNT}, жду ${RETRY_DELAY}с...`);
    await sleep(RETRY_DELAY);
    return fetchWithRetry(url, options, attempt + 1);
  }
}

/**
 * Проверяет, что сервис отвечает.
 */
async function checkService(name, url) {
  for (let i = 1; i <= RETRY_COUNT; i++) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.status < 500) {
        console.log(`✓ ${name} доступен (${url})`);
        return true;
      }
    } catch {
      // Сервис ещё не запущен
    }
    if (i === RETRY_COUNT) {
      console.error(`✗ ${name} не отвечает после ${RETRY_COUNT} попыток`);
      return false;
    }
    await sleep(RETRY_DELAY);
  }
  return false;
}

// ============================================================================
// qBittorrent
// ============================================================================

/**
 * Логинится в qBittorrent и возвращает cookie SID.
 */
async function loginToQbittorrent() {
  console.log('\n=== qBittorrent: вход ===');

  const loginUrl = `${QBITTORRENT_URL}/api/v2/auth/login`;
  const response = await fetchWithRetry(loginUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `username=${encodeURIComponent(QBITTORRENT_USERNAME)}&password=${encodeURIComponent(QBITTORRENT_PASSWORD)}`,
  });

  if (!response.ok) {
    throw new Error(`qBittorrent login failed: ${response.status} ${response.statusText}`);
  }

  const setCookie = response.headers.get('set-cookie') ?? '';
  const sidMatch = setCookie.match(/SID=([^;]+)/);
  if (!sidMatch) {
    throw new Error('qBittorrent login succeeded but SID cookie not found');
  }

  console.log('✓ qBittorrent: вход выполнен');
  return sidMatch[1];
}

/**
 * Получает информацию о qBittorrent.
 */
async function qbittorrentInfo(sid) {
  const response = await fetch(`${QBITTORRENT_URL}/api/v2/app/version`, {
    headers: { Cookie: `SID=${sid}` },
  });
  if (!response.ok) {
    throw new Error(`qBittorrent info failed: ${response.status}`);
  }
  return response.text();
}

// ============================================================================
// Prowlarr
// ============================================================================

/**
 * Делает запрос к API Prowlarr.
 */
async function prowlarrRequest(path, options = {}) {
  const response = await fetchWithRetry(`${PROWLLARR_URL}/api/v1${path}`, {
    headers: {
      'X-Api-Key': PROWLLARR_API_KEY,
      'Accept': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (response.status >= 400) {
    const text = await response.text().catch(() => '');
    throw new Error(`Prowlarr API ${path} failed: ${response.status} ${text}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

/**
 * Проверяет, что Prowlarr API отвечает.
 */
async function checkProwlarrApi() {
  console.log('\n=== Prowlarr: проверка API ===');
  await prowlarrRequest('/system/status');
  console.log('✓ Prowlarr API отвечает');
}

// ============================================================================
// Lidarr
// ============================================================================

/**
 * Делает запрос к API Lidarr.
 */
async function lidarrRequest(path, options = {}) {
  const response = await fetchWithRetry(`${LIDARR_URL}/api/v1${path}`, {
    headers: {
      'X-Api-Key': LIDARR_API_KEY,
      'Accept': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (response.status >= 400) {
    const text = await response.text().catch(() => '');
    throw new Error(`Lidarr API ${path} failed: ${response.status} ${text}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  return response.text();
}

/**
 * Проверяет, что Lidarr API отвечает.
 */
async function checkLidarrApi() {
  console.log('\n=== Lidarr: проверка API ===');
  await lidarrRequest('/system/status');
  console.log('✓ Lidarr API отвечает');
}

/**
 * Получает список загрузчиков в Lidarr.
 */
async function getLidarrDownloadClients() {
  return lidarrRequest('/downloadclient');
}

/**
 * Добавляет qBittorrent как загрузчик в Lidarr.
 */
async function addQbittorrentToLidarr() {
  console.log('\n=== Lidarr: добавление загрузчика qBittorrent ===');

  // Проверяем, не добавлен ли уже
  const existing = await getLidarrDownloadClients();
  const alreadyExists = existing.some((dc) => dc.name?.toLowerCase() === 'qbittorrent');
  if (alreadyExists) {
    console.log('✓ qBittorrent уже добавлен как загрузчик в Lidarr');
    return;
  }

  const downloadClient = {
    name: 'qBittorrent',
    downloadClientId: 'qbittorrent',
    enable: true,
    implementation: 'QBittorrent',
    configContract: 'QBittorrentSettings',
    fields: [
      { name: 'Host', value: QBITTORRENT_URL.replace(/^https?:\/\//, '').replace(/:8080$/, '') },
      { name: 'Port', value: 8080 },
      { name: 'Username', value: QBITTORRENT_USERNAME },
      { name: 'Password', value: QBITTORRENT_PASSWORD },
      { name: 'Category', value: 'lidarr' },
      { name: 'UseSSL', value: false },
      { name: 'AddPaused', value: false },
    ],
  };

  await lidarrRequest('/downloadclient', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(downloadClient),
  });

  console.log('✓ qBittorrent добавлен как загрузчик в Lidarr');
}

/**
 * Получает список индексаторов в Lidarr.
 */
async function getLidarrIndexers() {
  return lidarrRequest('/indexer');
}

/**
 * Добавляет Prowlarr как индексатор в Lidarr.
 */
async function addProwlarrToLidarr() {
  console.log('\n=== Lidarr: добавление индексатора Prowlarr ===');

  // Проверяем, не добавлен ли уже
  const existing = await getLidarrIndexers();
  const alreadyExists = existing.some((idx) => idx.name?.toLowerCase() === 'prowlarr');
  if (alreadyExists) {
    console.log('✓ Prowlarr уже добавлен как индексатор в Lidarr');
    return;
  }

  const prowlarrIndexer = {
    name: 'Prowlarr',
    enable: true,
    implementation: 'Prowlarr',
    configContract: 'ProwlarrSettings',
    fields: [
      { name: 'Host', value: PROWLLARR_URL.replace(/^https?:\/\//, '') },
      { name: 'Port', value: PROWLLARR_URL.includes('https') ? 443 : 80 },
      { name: 'ApiKey', value: PROWLLARR_API_KEY },
      { name: 'SyncInterval', value: 15 },
      { name: 'Categories', value: '5030,5040,5045,5050,5060,5070,5080,5090' },
    ],
  };

  await lidarrRequest('/indexer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prowlarrIndexer),
  });

  console.log('✓ Prowlarr добавлен как индексатор в Lidarr');
}

// ============================================================================
// Основной поток
// ============================================================================

async function main() {
  console.log('🚀 Настройка Arr-стека (qBittorrent + Prowlarr + Lidarr)\n');
  console.log(`  Prowlarr: ${PROWLLARR_URL}`);
  console.log(`  Lidarr:   ${LIDARR_URL}`);
  console.log(`  qBittorrent: ${QBITTORRENT_URL}\n`);

  // 1. Проверяем доступность сервисов
  console.log('=== Проверка доступности сервисов ===');
  const servicesOk = await Promise.all([
    checkService('qBittorrent', `${QBITTORRENT_URL}/api/v2/app/version`),
    checkService('Prowlarr', `${PROWLLARR_URL}/api/v1/system/status`),
    checkService('Lidarr', `${LIDARR_URL}/api/v1/system/status`),
  ]);

  if (!servicesOk.every(Boolean)) {
    console.error('\nНе все серверы доступны. Запустите `docker compose up -d` и повторите.');
    process.exit(1);
  }

  // 2. Prowlarr API
  await checkProwlarrApi();

  // 3. Lidarr API
  await checkLidarrApi();

  // 4. qBittorrent
  const sid = await loginToQbittorrent();
  const version = await qbittorrentInfo(sid);
  console.log(`✓ qBittorrent версия: ${version}`);

  // 5. Добавляем загрузчик в Lidarr
  await addQbittorrentToLidarr();

  // 6. Добавляем индексатор в Lidarr
  await addProwlarrToLidarr();

  // 7. Итог
  console.log('\n✅ Arr-стек настроен!');
  console.log('\nСледующие шаги (вручную в Web UI):');
  console.log('  1. Prowlarr (http://127.0.0.1:9696): добавьте индексаторы (трекеры)');
  console.log('  2. Lidarr (http://127.0.0.1:8686): настройте профили качества, корневую папку /music');
  console.log('  3. Добавьте артистов/альбомы в Lidarr для скачивания');
  console.log('\nПоток: Трекер → Prowlarr → Lidarr → qBittorrent → /music → Navidrome → Persephone');
}

main().catch((err) => {
  console.error('\n❌ Ошибка настройки Arr-стека:');
  console.error(err);
  process.exit(1);
});