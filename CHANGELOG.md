# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).  
Версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- Спецификация проекта `PROJECT_SPEC.md` (версия 0.2).
- Правила разработки `AGENTS.md`.
- Документация: `ARCHITECTURE.md`, `ROADMAP.md`, `DEVELOPMENT_STATUS.md`, `TASKS.md`.
- Документы `docs/DATA_MODEL.md`, `docs/INTEGRATIONS.md`, `docs/SECURITY.md`, `docs/RECOMMENDATION_ENGINE.md`, `docs/PREFETCH_ENGINE.md`.
- ADR 0001–0005: модульный монолит, Original First, PostgreSQL как источник истины, Last.fm для каждого пользователя, абстракция хранилищ, forward-only миграции, Web Player и Subsonic API совместимость.
- Шаблон конфигурации `.env.example`, `.gitignore`, `.editorconfig`.
- GitHub Issue/PR-шаблоны, `dependabot.yml`, CI workflow.
- Labels и Milestones для этапов проекта.
- GitHub Project #6: доска, поля Status/Stage/Priority/Work Type/Component/Estimate, README проекта.
- Issues #1–#21 для Stage 0–10, добавленные в Project с приоритетами и этапами.
- GitHub Discussions включены для вопросов и предложений.
- Ветки `main` и `develop`.

#### Stage 0 — инфраструктура

- Backend на Node.js 22 (ESM): Fastify 5, `pg`, `ioredis`, BullMQ, pino.
- Валидация конфигурации при старте с сообщениями без раскрытия значений секретов.
- AES-256-GCM-шифрование секретов с версией ключа и аутентификацией payload.
- Пул PostgreSQL и Redis-клиент с настраиваемыми таймаутами.
- Forward-only runner миграций: `schema_migrations`, SHA-256, advisory lock, транзакция на миграцию.
- Начальная схема БД: 24 таблицы, ограничения, индексы, триггеры `updated_at`, `pgcrypto` и `citext`.
- CLI `migrate`, `migrate:status` и `verify:schema`.
- API: `/api/v1/health/live`, `/api/v1/health/ready`, request ID, единый формат ошибок, security-заголовки, redaction в логах.
- Worker: BullMQ, отдельное соединение heartbeat, healthcheck и graceful shutdown.
- Multi-stage `app/Dockerfile` для development и production.
- `docker-compose.yml`: PostgreSQL, Redis, migrate, API, Worker, Navidrome, Lidarr с фиксированными тегами и health checks.
- `docker-compose.dev.yml`: PostgreSQL и Redis только на `127.0.0.1`.
- CI: линтер, unit-тесты, миграции на чистой БД, проверка схемы, Docker build, Compose config.
- Unit- и интеграционные тесты: 152 тестов.

#### Stage 1 — Users & Library

- Auth: регистрация, логин, управление сессиями (SHA-256 хеши токенов, TTL 7 дней, argon2id)
- Storage roots: CRUD управление корнями хранения медиа-файлов
- Library search: поиск по artistas, трекам, релизам с LIKE-запросами и пагинацией
- Media indexer: сканирование файлов, извлечение метаданных (music-metadata), worker-обработка
- MusicBrainz matching: точное и нечёткое совпадение записей

#### Stage 2 — Playback

- Navidrome интеграция: поиск треков, получение stream URL
- HTTP Range стриминг с поддержкой перемотки
- Playback sessions: старт, heartbeat (позиция), завершение
- История прослушиваний с пагинацией
- Scrobble queue: очередь повторных отправок на Last.fm
- Now Playing API

#### Stage 3 — Last.fm

- OAuth flow: авторизация через Last.fm, обмен токена на session key
- Зашифрованное хранение session key (AES-256-GCM)
- Now Playing обновления
- Scrobbling: отправка прослушанных треков
- Загрузка персональных данных: loved tracks, top artists, recent tracks

#### Stage 4 — User Preferences

- Избранное: toggle like, история лайков
- Пропуски: skip recording с position tracking
- Плейлисты: CRUD операции, управление треками в плейлисте
- Предпочтения исполнителей и треков (affinity score)

#### Stage 5 — Recommendation Engine

- Генерация кандидатов: лайки, схожие артисты, недавние прослушивания
- Персональное ранжирование с diversity control
- Фильтрация и дедупликация
- Объяснения рекомендаций (человеко-читаемые причины)
- Радио: playlist из seed-трека

#### Stage 6 — Prefetch Engine

- Прогноз следующих композиций на основе истории прослушивания
- Проверка наличия файлов в media_assets
- Задачи получения контента с приоритетами
- Повторные попытки с max_attempts
- API для управления задачами (CRUD + статус)

#### Stage 7 — Web Player & Subsonic API

- Web Player API: stream URL, Now Playing, история, доступные ассеты
- Subsonic API: ping, getLicenses, getMusicFolders, search3, getAlbumList, getArtist, playQueue, getStreamUrl, getCoverArt, scrobble
- ADR 0005: архитектурное решение для Web Player и Subsonic

#### Stage 8 — CI/CD Pipeline

- GitHub Actions CI: линтер, тесты, миграции, Docker build, security audit
- GitHub Actions Docker Build: сборка и пуш образа на Docker Hub
- GitHub Actions Release: создание GitHub Release на теги v*
- Issue templates: bug report, feature request
- Pull Request template

#### Stage 10 — Lidarr авто-скачивание

- Lidarr API клиент: поиск исполнителей, добавление в библиотеку с monitored: true
- `download_requests` таблица: отслеживание статуса скачивания (pending, sending, downloading, completed, failed, cancelled)
- Авто-запрос в Lidarr при поиске/воспроизведении недоступного трека
- `qBittorrent` + `Prowlarr` сервисы в docker-compose с общим volumen `/downloads`
- `scripts/setup-project.js`: единая точка настройки (`npm run setup`)
- API: `GET/POST/GET/DELETE /api/v1/downloads/requests`, `GET /api/v1/downloads/status`
- `available_locally` + `download_status` в ответах поиска и деталей записи

### Changed

- `main.md` переименован в `PROJECT_SPEC.md`.
- `AGENTS.MD` переименован в `AGENTS.md`.
- API и Worker используют общий образ, но разные команды запуска.
- `README.md`, `ROADMAP.md`, `TASKS.md`, `DEVELOPMENT_STATUS.md`, `app/README.md` обновлены под текущее состояние.

### Fixed

- `commandTimeout: 0` в ioredis v6 трактовался как немедленный таймаут и ломал BullMQ-соединение; теперь таймаут для блокирующих команд не задаётся.
- Дублирующее объявление `makeAuth` в `lastfm-integration.test.js`.
- Неиспользуемые параметры в тестах и сервисах (ESLint clean).
- `playQueue` в Subsonic клиенте: ссылка на несуществующую таблицу `play_queue` заменена на `playback_queues` + `playback_queue_items`.

### Verified

- Линтер: 0 ошибок
- Тесты: 152 пройдено, 10 пропущено (15 файлов)
- Миграции применяются на пустой PostgreSQL 16, повторный запуск идемпотентен.
- Схема соответствует ожидаемой.
- Полный Docker Compose stack поднимается, все сервисы healthy.
- API `live`/`ready` отвечают `200`, Worker публикует heartbeat.
- `npm audit`: 0 уязвимостей.

### Not yet released

Версия `0.1.0` будет выпущена после слияния `develop` в `main` и зелёного CI.

## [0.1.0] — не выпущено

Первый релиз будет создан после завершения всех этапов Roadmap.
