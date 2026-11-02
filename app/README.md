# app — backend Persephone Music

**Статус:** Stage 10 — Lidarr авто-скачивание. Все этапы Roadmap (0–10) реализованы.

Backend — модульный монолит на Node.js 22 LTS (JavaScript, ESM). API и Worker используют общий код, но запускаются отдельными процессами.

## Структура

```text
app/
├── package.json
├── Dockerfile
├── eslint.config.js
├── vitest.config.js
├── test/
└── src/
    ├── api/
    │   ├── routes/          # health-маршруты
    │   ├── app.js           # сборка Fastify
    │   └── server.js        # запуск API
    ├── modules/
    │   ├── auth/            # аутентификация (регистрация, логин, сессии)
    │   ├── library/         # поиск и просмотр библиотеки
    │   ├── playback/        # воспроизведение (Navidrome, сессии, стрим)
    │   ├── lastfm/          # Last.fm интеграция
    │   ├── users/           # пользовательские данные (лайки, пропуски)
    │   ├── playlists/       # плейлисты
    │   ├── recommendations/ # Recommendation Engine
    │   ├── prefetch/        # Prefetch Engine
    │   ├── player/          # Web Player API
    │   └── subsonic/        # Subsonic API совместимость
    ├── integrations/        # адаптеры внешних сервисов (Last.fm, Navidrome)
    ├── workers/
    │   ├── worker.js        # процесс BullMQ
    │   ├── heartbeat.js     # ключ готовности в Redis
    │   ├── healthcheck.js   # Docker healthcheck
    │   └── processor-registry.js
    ├── db/
    │   ├── migrations/      # forward-only SQL-миграции
    │   ├── queries/         # SQL-запросы
    │   ├── migrate.js
    │   ├── migrate-cli.js
    │   ├── verify-schema.js
    │   ├── verify-schema-cli.js
    │   └── pool.js
    ├── config/
    └── utils/
```

## Требования

- Node.js 22.9+ (используется `--env-file-if-exists`).
- PostgreSQL 16.
- Redis 7.

## Локальный запуск

Из корня репозитория:

```bash
cp .env.example .env
# заполнить POSTGRES_PASSWORD, SESSION_SECRET и SECRET_ENCRYPTION_KEY
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

`docker-compose.dev.yml` публикует PostgreSQL и Redis только на `127.0.0.1`.

Затем:

```bash
cd app
npm ci
npm run migrate
npm run dev:api
# в отдельном терминале:
npm run dev:worker
```

`DATABASE_URL` и `REDIS_URL` в `.env` должны указывать на `127.0.0.1` (см. `.env.example`).

Секреты можно сгенерировать так:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # SECRET_ENCRYPTION_KEY (ровно 32 байта)
```

## Команды

| Команда | Назначение |
|---|---|
| `npm run dev:api` | API с перезапуском при изменениях |
| `npm run start:api` | API без watch |
| `npm run dev:worker` | Worker с перезапуском при изменениях |
| `npm run start:worker` | Worker без watch |
| `npm run migrate` | Применить ожидающие миграции |
| `npm run migrate:status` | Показать состояние миграций |
| `npm run verify:schema` | Проверить таблицы, индексы и расширения |
| `npm run lint` | ESLint |
| `npm test` | Все тесты (интеграционные требуют `TEST_DATABASE_URL`) |
| `npm run test:watch` | Vitest в watch-режиме |

## Health checks

| Endpoint | Назначение |
|---|---|
| `GET /api/v1/health/live` | Процесс API жив |
| `GET /api/v1/health/ready` | PostgreSQL и Redis доступны (503 при ошибке) |

Worker публикует ключ `persephone:worker:heartbeat` в Redis с TTL 30 секунд. `src/workers/healthcheck.js` проверяет его наличие и используется Docker healthcheck.

## Web Player API

| Endpoint | Метод | Описание |
|---|---|---|
| `/api/v1/player/stream/:mediaAssetId` | GET | URL стрима для HTML5 аудио плеера |
| `/api/v1/player/now-playing` | GET | Текущий трек (Now Playing) |
| `/api/v1/player/history` | GET | История воспроизведения |
| `/api/v1/player/assets` | GET | Список доступных медиа-ассетов |

Все маршруты требуют аутентификации (заголовок `Authorization: Bearer <token>`).

## Subsonic API

| Endpoint | Метод | Описание |
|---|---|---|
| `/rest/ping` | GET | Проверка соединения |
| `/rest/getLicenses` | GET | Информация о лицензии |
| `/rest/getMusicFolders` | GET | Папки с музыкой |
| `/rest/search3` | GET | Поиск треков/артистов/альбомов |
| `/rest/getAlbumList` | GET | Список альбомов |
| `/rest/getArtist` | GET | Информация об исполнителе |
| `/rest/playQueue` | GET | Очередь воспроизведения |
| `/rest/getStreamUrl` | GET | URL стрима медиа-ассета |
| `/rest/getCoverArt` | GET | Обложка альбома |
| `/rest/scrobble` | GET | Отправка скроббла |

Аутентификация через параметры `u` (username) и `t` (token) или `p` (пароль).

## Lidarr Download API

| Endpoint | Метод | Описание |
|---|---|---|
| `/api/v1/downloads/status` | GET | Проверить, настроен ли Lidarr |
| `/api/v1/downloads/requests` | GET | Список запросов на скачивание пользователя |
| `/api/v1/downloads/requests` | POST | Запросить скачивание исполнителя (авто, при поиске/воспроизведении) |
| `/api/v1/downloads/requests/:id` | GET | Статус конкретного запроса |
| `/api/v1/downloads/requests/:id` | DELETE | Отменить запрос на скачивание |

## Как работает скачивание

Пользователь не скачивает треки вручную. При поиске или попытке воспроизведения трека, которого нет локально, система автоматически:
1. Создаёт запрос в `download_requests` со статусом `sending`
2. Отправляет исполнителя в Lidarr (`addArtist` с `monitored: true`)
3. Lidarr ищет релиз через Prowlarr → qBittorrent скачивает в `/downloads`
4. Lidarr импортирует файл в `/music`
5. Navidrome сканирует `/music`
6. Persephone Media Indexer индексирует файл
7. Трек становится доступен для стрима

## Тесты

Unit-тесты не требуют внешних сервисов. Интеграционные тесты миграций включаются только при заданном `TEST_DATABASE_URL`, имя базы должно оканчиваться на `_test`:

```bash
TEST_DATABASE_URL=postgresql://persephone:***@127.0.0.1:55432/persephone_test npm test
```

Тесты сами удаляют схему `public`, применяют миграции и проверяют ограничения. **Не указывайте в `TEST_DATABASE_URL` рабочую базу.**

## Миграции

- Файлы: `src/db/migrations/NNNN_name.sql`, forward-only.
- Применённые миграции записываются в `schema_migrations` с SHA-256.
- Изменение уже применённого файла обнаруживается по контрольной сумме.
- Каждая миграция выполняется в отдельной транзакции под advisory lock.

Подробности: [ADR 0006](../docs/adr/0006-forward-only-migrations.md).

## Правила

1. Бизнес-логика не размещается в HTTP-маршрутах: маршрут вызывает модуль/сервис.
2. Модуль не импортирует внутренности другого модуля.
3. Внешние сервисы доступны только через адаптеры `integrations/`.
4. SQL — только в `db/queries/` или миграциях, не в маршрутах.
5. Конфигурация — только через `config/`, с валидацией при старте.
6. Секреты не логируются и не возвращаются API.
7. Каждая пользовательская операция проверяет владельца ресурса.
8. Все изменения схемы — миграциями.
9. Ошибки интеграций классифицируются и не превращаются в фиктивные успешные ответы.
10. Тесты обязательны для новой логики.

## Технологии

| Назначение | Технология |
|---|---|
| HTTP | Fastify 5 |
| PostgreSQL | `pg` |
| Redis/очереди | `ioredis`, BullMQ |
| Логирование | `pino` |
| Тесты | Vitest |
| Линтер | ESLint |

## Связанные документы

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/DATA_MODEL.md](../docs/DATA_MODEL.md)
- [docs/INTEGRATIONS.md](../docs/INTEGRATIONS.md)
- [docs/SECURITY.md](../docs/SECURITY.md)
- [docs/adr/0005-web-player-subsonic.md](../docs/adr/0005-web-player-subsonic.md) — ADR для Web Player и Subsonic
- [docs/adr/0006-download-stack.md](../docs/adr/0006-download-stack.md) — ADR для загрузки через Lidarr
