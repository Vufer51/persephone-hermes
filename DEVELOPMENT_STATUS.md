# Development Status

**Проект:** Persephone Music
**Обновлено:** 2026-10-31
**Текущий этап:** Stage 0 — Infrastructure MVP (реализован, ожидает PR/CI)

Документ отражает **фактическое** состояние. Наличие файла или документа не означает, что функциональность реализована.

## Implemented

| Область | Что сделано |
|---|---|
| Документация | `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `AGENTS.md`, `docs/` |
| Модель данных | Концептуальная модель и SQL-схема из 24 таблиц, ограничений, индексов и триггеров |
| Конфигурация | Валидация обязательных переменных, запрет небезопасных значений, redacted-описание |
| Секреты | AES-256-GCM с версией ключа и аутентификацией payload |
| Миграции | Forward-only runner, `schema_migrations`, advisory lock, транзакция на миграцию, проверка SHA-256 |
| Проверка схемы | CLI-проверка таблиц, расширений и индексов |
| API | Fastify 5, `/api/v1/health/live`, `/api/v1/health/ready`, единый формат ошибок, request ID, security-заголовки, pino |
| Worker | BullMQ Worker, отдельное соединение для heartbeat, healthcheck, graceful shutdown |
| Docker | Multi-stage Dockerfile, Compose-стек из PostgreSQL, Redis, migrate, API, Worker, Navidrome, Lidarr |
| Сеть Docker | PostgreSQL и Redis без публикации портов; Navidrome/Lidarr только на `127.0.0.1` |
| Локальная разработка | `docker-compose.dev.yml` публикует PostgreSQL/Redis только на `127.0.0.1` |
| CI | GitHub Actions: линтер, unit-тесты, миграции на чистой БД, схема, Docker build, Compose config |
| Зависимости | Dependabot для npm, Docker и GitHub Actions |
| Процесс | GitFlow, Issue/PR-шаблоны, Labels, Milestones, Issues #1–#6 |

## Tested

Проверки выполнены локально 2026-10-31.

| Проверка | Результат |
|---|---|
| `npm run lint` | Успешно, без замечаний |
| `npm test` без внешней БД | 41 unit-тест пройден, 10 интеграционных пропущены |
| `npm test` с `TEST_DATABASE_URL` | 51 тест пройден, включая 10 интеграционных |
| `npm run migrate` на пустой базе | Применена миграция `0001_initial_schema.sql` |
| Повторный `npm run migrate` | Новых миграций нет, повторного применения нет |
| `npm run verify:schema` | Схема соответствует ожидаемой |
| `npm audit` | 0 уязвимостей |
| `docker compose config` | Базовая конфигурация и dev override валидны |
| `docker compose build` | Production-образ собран |
| Полный `docker compose up -d` | Все сервисы healthy; `migrate` завершился с кодом 0 |
| `GET /api/v1/health/live` | `200`, `status: ok` |
| `GET /api/v1/health/ready` | `200`, PostgreSQL и Redis `ok` |
| Схема в контейнере | 25 таблиц, включая `schema_migrations` |
| Worker heartbeat | Ключ `persephone:worker:heartbeat` обновляется, TTL уменьшается |
| Graceful shutdown | API и Worker завершаются по `SIGTERM` без ошибок |
| Healthcheck-инструменты | `wget`/`curl` присутствуют в образах Navidrome и Lidarr |
| Отсутствие секретов | `.env` в `.gitignore`, в репозитории только заглушки |

## Partially implemented

| Область | Что есть | Чего нет |
|---|---|---|
| Worker | Процесс, очередь и heartbeat | Зарегистрированные процессоры задач |
| API | Health-маршруты и обработка ошибок | Аутентификация и бизнес-маршруты |
| Схема БД | Таблицы Stage 0 | Запросы и репозитории |
| CI | Workflow создан | Результат первого запуска на GitHub |

## Planned

| Область | Задача |
|---|---|
| Stage 1 | Пользователи, сессии, storage roots, индексатор, MusicBrainz matching |
| Branch protection | Включить после появления CI-проверок и подходящего тарифа GitHub |

## Not implemented

- аутентификация, регистрация, сессии;
- музыкальный каталог, индексатор, MusicBrainz matching;
- воспроизведение, HTTP Range, playback sessions;
- интеграция Last.fm и скробблинг;
- плейлисты, очереди, избранное, пропуски;
- Recommendation Engine и радио;
- Prefetch Engine;
- Web Player;
- Subsonic API;
- бизнес-логика API и процессоры Worker.

## Known limitations

- Stage 0 содержит только инфраструктуру: API отвечает лишь health-маршрутами.
- `transcode_policy` в MVP допускает только `source` (Original First).
- Branch protection для `main`/`develop` не настроена: GitHub возвращает `403` для приватного репозитория на текущем тарифе.
- CI создан, но ещё не запускался на GitHub: результат будет известен после открытия Pull Request.
- GitHub Project [#6](https://github.com/orgs/DrRocksoDevelopment/projects/6): представления Table/Roadmap и встроенные Workflows создаются в UI, публичный API GitHub ими не управляет.
- Лицензия проекта не выбрана.

## Next step

1. Открыть Pull Request `feature/stage-0-infrastructure` → `develop`.
2. Дождаться зелёного CI и провести review.
3. Закрыть Issues [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2)–[#6](https://github.com/DrRocksoDevelopment/persephone/issues/6) и перевести их в Done.
4. Слить `develop` → `main`, подготовить релиз `0.1.0`.
5. Спланировать Stage 1 (Users & Library) отдельными Issues.
