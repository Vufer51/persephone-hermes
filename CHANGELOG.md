# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- Спецификация проекта `PROJECT_SPEC.md` (версия 0.2).
- Правила разработки `AGENTS.md`.
- Документация: `ARCHITECTURE.md`, `ROADMAP.md`, `DEVELOPMENT_STATUS.md`, `TASKS.md`.
- Документы `docs/DATA_MODEL.md`, `docs/INTEGRATIONS.md`, `docs/SECURITY.md`, `docs/RECOMMENDATION_ENGINE.md`, `docs/PREFETCH_ENGINE.md`.
- ADR 0001–0006: модульный монолит, Original First, PostgreSQL как источник истины, Last.fm для каждого пользователя, абстракция хранилищ, forward-only миграции.
- Шаблон конфигурации `.env.example`, `.gitignore`, `.editorconfig`.
- GitHub Issue/PR-шаблоны, `dependabot.yml`, CI workflow.
- Labels и Milestones для этапов проекта.
- GitHub Project #6: доска, поля Status/Stage/Priority/Work Type/Component/Estimate, README проекта.
- Issues #1–#6 для Stage 0, добавленные в Project с приоритетами и этапами.
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
- Unit- и интеграционные тесты: 51 тест.

### Changed

- `main.md` переименован в `PROJECT_SPEC.md`.
- `AGENTS.MD` переименован в `AGENTS.md`.
- API и Worker используют общий образ, но разные команды запуска.
- `README.md`, `ROADMAP.md`, `TASKS.md`, `DEVELOPMENT_STATUS.md`, `app/README.md` обновлены под фактическое состояние Stage 0.

### Fixed

- `commandTimeout: 0` в ioredis v6 трактовался как немедленный таймаут и ломал BullMQ-соединение; теперь таймаут для блокирующих команд не задаётся.

### Verified

- Линтер и 51 тест проходят.
- Миграции применяются на пустой PostgreSQL 16, повторный запуск идемпотентен.
- Схема соответствует ожидаемой.
- Полный Docker Compose stack поднимается, все сервисы healthy.
- API `live`/`ready` отвечают `200`, Worker публикует heartbeat.
- `npm audit`: 0 уязвимостей.

### Not yet released

Версия `0.1.0` будет выпущена после слияния Stage 0 в `main` и зелёного CI.

## [0.1.0] — не выпущено

Первый релиз будет создан после завершения Stage 0.
