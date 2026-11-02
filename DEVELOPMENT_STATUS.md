# Development Status

**Проект:** Persephone Music  
**Обновлено:** 2026-11-02  
**Текущий этап:** Stage 10 — Lidarr авто-скачивание (реализован, влит в develop)

Документ отражает **фактическое** состояние. Наличие файла или документа не означает, что функциональность реализована.

## Implemented

| Область | Что сделано |
|---|---|
| Документация | `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `DEVELOPMENT_STATUS.md`, `AGENTS.md`, `docs/`, `CHANGELOG.md` |
| Модель данных | Концептуальная модель и SQL-схема из 24+ таблиц, ограничений, индексов и триггеров |
| Конфигурация | Валидация обязательных переменных, запрет небезопасных значений, redacted-описание |
| Секреты | AES-256-GCM с версией ключа и аутентификацией payload |
| Миграции | Forward-only runner, `schema_migrations`, advisory lock, транзакция на миграцию, проверка SHA-256 |
| Проверка схемы | CLI-проверка таблиц, расширений и индексов |
| API | Fastify 5, `/api/v1/health/live`, `/api/v1/health/ready`, единый формат ошибок, request ID, security-заголовки, pino |
| Auth | Регистрация, логин, управление сессиями (JWT + SHA-256 хеши, TTL 7 дней) |
| Library | Storage roots, media indexer (SHA256 + music-metadata), MusicBrainz matching, search/browse (артисты, треки, релизы, медиа) |
| Playback | Navidrome интеграция, HTTP Range стриминг, playback sessions, Now Playing, история прослушиваний, scrobble queue |
| Last.fm | OAuth flow, зашифрованное хранение session key (AES-256-GCM), Now Playing, scrobbling, загрузка персональных данных |
| User Preferences | Избранное (like/dislike), пропуски с position tracking, плейлисты (CRUD), предпочтения артистов и треков |
| Recommendation Engine | Генерация кандидатов (лайки, схожие артисты, недавние прослушивания), радио, объяснения рекомендаций |
| Prefetch Engine | Прогноз следующих композиций, проверка наличия файлов, задачи получения контента с приоритетами и повторными попытками |
| Web Player | HTML5 аудио стриминг, Now Playing, история, список доступных ассетов (`/api/v1/player/*`) |
| Subsonic API | ping, getLicenses, getMusicFolders, search3, getAlbumList, getArtist, playQueue, getStreamUrl, getCoverArt, scrobble (`/rest/*`) |
| Worker | BullMQ Worker, процессор скробблов, отдельное соединение для heartbeat, healthcheck, graceful shutdown |
| Docker | Multi-stage Dockerfile, Compose-стек из PostgreSQL, Redis, API, Worker, Navidrome, Lidarr |
| CI | GitHub Actions: линтер, unit-тесты, миграции на чистой БД, схема, Docker build, security audit |
| Зависимости | Dependabot для npm, Docker и GitHub Actions |
| Процесс | GitFlow, Issue/PR-шаблоны, Labels, Milestones, ADR 0001-0005, Issues #1-#21 |

## Tested

Проверки выполнены локально 2026-11-02.

| Проверка | Результат |
|---|---|
| `npm run lint` | Успешно, 0 ошибок |
| `npm test` | 152 тестов пройдено, 10 пропущено (15 файлов) |
| `npm run migrate` на пустой базе | Применены миграции `0001_initial_schema.sql`, `0002_download_requests.sql` |
| `npm run verify:schema` | Схема соответствует ожидаемой |
| `npm audit` | 0 уязвимостей |
| `docker compose config` | Конфигурация валидна |
| `GET /api/v1/health/live` | `200`, `status: ok` |
| `GET /api/v1/health/ready` | `200`, PostgreSQL и Redis `ok` |

## Git

| Ветка | Статус | Последний коммит |
|---|---|---|
| `develop` | Актуальна | `1ea71ad` — Merge PR #24 (Stage 10 Lidarr autodownload) |
| `main` | Стабильная | Ожидает слияния `develop` |

## Known limitations

- Branch protection для `main`/`develop` не настроена: GitHub возвращает `403` для приватного репозитория на текущем тарифе.
- GitHub Project: представления Table/Roadmap создаются в UI.
- Лицензия проекта не выбрана.
- Нет полноценного веб-интерфейса (только API для Web Player и Subsonic).
- Lidarr требует ручной настройки в Web UI: добавить индексаторы в Prowlarr, связать qBittorrent как загрузчик, настроить профиль качества и корневую папку.
- Нет production-мониторинга (Prometheus, Grafana, ELK).

## Next step

1. Закрыть Issues #1-#21 и перевести их в Done.
2. Слить `develop` → `main`, подготовить релиз `0.1.0`.
3. Добавить веб-интерфейс (React/Vue) для Web Player API.
4. Добавить мониторинг и алертинг для production.
