# Persephone Music

**Одна музыкальная библиотека — множество независимых музыкальных миров.**

Persephone Music — самостоятельно размещаемая многопользовательская музыкальная платформа: стриминг собственной библиотеки, персональный музыкальный дневник, рекомендательная система и интеллектуальное управление библиотекой.

> **Текущий статус:** Stage 0 — Infrastructure MVP реализован.
> Работают API и Worker, миграции и начальная схема БД, Docker Compose, health checks, CI и тесты.
> Бизнес-функциональность (пользователи, библиотека, воспроизведение, Last.fm, рекомендации) появится на следующих этапах.
> Актуальное состояние: [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).

## Документы

| Документ | Назначение |
|---|---|
| [PROJECT_SPEC.md](PROJECT_SPEC.md) | Основная концепция и техническая спецификация |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Архитектура приложения и границы модулей |
| [ROADMAP.md](ROADMAP.md) | Этапы разработки и их статус |
| [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) | Что реализовано, проверено и запланировано |
| [TASKS.md](TASKS.md) | Текущие задачи и ссылки на Issues |
| [AGENTS.md](AGENTS.md) | Обязательные правила разработки |
| [docs/PROJECT_MANAGEMENT.md](docs/PROJECT_MANAGEMENT.md) | GitHub Project: поля, статусы, представления, автоматизация |
| [docs/](docs/) | Модель данных, интеграции, безопасность, движки |
| [docs/adr/](docs/adr/) | Архитектурные решения (ADR) |
| [CHANGELOG.md](CHANGELOG.md) | История изменений |

## Структура репозитория

```text
persephone/
├── AGENTS.md
├── PROJECT_SPEC.md
├── README.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── DEVELOPMENT_STATUS.md
├── TASKS.md
├── CHANGELOG.md
├── docker-compose.yml          # базовый стек
├── docker-compose.dev.yml      # публикация PostgreSQL/Redis на 127.0.0.1
├── .env.example
│
├── .github/
│   ├── workflows/ci.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── app/                        # backend: API + Worker
│   ├── Dockerfile
│   ├── package.json
│   ├── eslint.config.js
│   ├── vitest.config.js
│   ├── src/
│   │   ├── api/                # Fastify: приложение, сервер, health-маршруты
│   │   ├── workers/            # BullMQ Worker, heartbeat, healthcheck
│   │   ├── db/                 # пул, миграции, проверка схемы
│   │   ├── services/           # Redis-клиент
│   │   ├── config/             # валидация окружения
│   │   └── utils/              # логи, таймауты, shutdown, шифрование
│   └── test/                   # unit- и интеграционные тесты
│
├── docs/
│   ├── DATA_MODEL.md
│   ├── INTEGRATIONS.md
│   ├── SECURITY.md
│   ├── RECOMMENDATION_ENGINE.md
│   ├── PREFETCH_ENGINE.md
│   ├── PROJECT_MANAGEMENT.md
│   └── adr/
│
├── scripts/                    # структура зарезервирована
└── web/                        # frontend (структура зарезервирована)
```

## Технологический стек

| Компонент | Технология |
|---|---|
| Backend | Node.js 22 LTS, JavaScript ESM |
| HTTP API | Fastify 5 |
| База данных | PostgreSQL 16 |
| Очереди и кэш | Redis 7, BullMQ |
| Playback | Navidrome (Original First) |
| Управление библиотекой | Lidarr |
| Метаданные | MusicBrainz |
| Персональные музыкальные данные | Last.fm |
| Контейнеризация | Docker Compose |
| Web UI | отдельный frontend-проект (не реализован) |

## Требования

- Docker Engine 24+ с Docker Compose v2 (или Docker Desktop).
- Для локального запуска без Docker: Node.js 22.9+ и npm 10+.

## Быстрый старт

```bash
git clone https://github.com/DrRocksoDevelopment/persephone.git
cd persephone
cp .env.example .env
```

Заполните в `.env` как минимум `POSTGRES_PASSWORD`, `SESSION_SECRET` и `SECRET_ENCRYPTION_KEY`:

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -base64 32   # SECRET_ENCRYPTION_KEY (ровно 32 байта)
```

В PowerShell секреты можно сгенерировать так:

```powershell
$bytes = New-Object byte[] 48
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)   # SESSION_SECRET

$key = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($key)
[Convert]::ToBase64String($key)     # SECRET_ENCRYPTION_KEY
```

Запуск:

```bash
docker compose up -d --build
```

Что происходит:

1. Поднимаются PostgreSQL 16 и Redis 7 (порты наружу не публикуются).
2. Одноразовый сервис `migrate` применяет миграции и завершается.
3. Запускаются API и Worker.
4. Запускаются Navidrome и Lidarr; их порты доступны только на `127.0.0.1`.

Проверка:

```bash
curl http://127.0.0.1:3000/api/v1/health/live
curl http://127.0.0.1:3000/api/v1/health/ready
docker compose ps
```

`ready` возвращает `200`, когда доступны PostgreSQL и Redis, и `503` иначе. В PowerShell используйте `Invoke-RestMethod http://127.0.0.1:3000/api/v1/health/ready`.

Остановка:

```bash
docker compose down          # контейнеры и сеть
docker compose down -v       # также удалить volumes с данными
```

## Локальная разработка

Поднимите только инфраструктуру. `docker-compose.dev.yml` публикует PostgreSQL и Redis **только на `127.0.0.1`**:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres redis
```

В `.env` укажите локальные адреса:

```dotenv
DATABASE_URL=postgresql://persephone:ВАШ_ПАРОЛЬ@127.0.0.1:5432/persephone
REDIS_URL=redis://127.0.0.1:6379/0
```

Затем:

```bash
cd app
npm ci
npm run migrate
npm run dev:api
# в отдельном терминале:
npm run dev:worker
```

Подробности и описание команд: [app/README.md](app/README.md).

## Тесты и проверки

```bash
cd app
npm run lint
npm test
```

Интеграционные тесты миграций требуют отдельную базу, имя которой оканчивается на `_test`:

```bash
TEST_DATABASE_URL=postgresql://persephone:test@127.0.0.1:5432/persephone_test npm test
```

Unit-тесты внешних сервисов не требуют. CI выполняет линтер, unit- и интеграционные тесты, применяет миграции на чистой базе, проверяет схему, собирает Docker-образ и валидирует Compose.

## Безопасность

- PostgreSQL и Redis не публикуют порты на хост в базовой конфигурации.
- Navidrome и Lidarr доступны только на `127.0.0.1`.
- Секреты передаются только через переменные окружения; `.env` исключён из Git.
- Обязательные переменные валидируются при старте.
- Last.fm session keys шифруются AES-256-GCM с версией ключа.
- Логи редактируют пароли, токены, cookie и ключи.

Требования и ограничения: [docs/SECURITY.md](docs/SECURITY.md).

## Процесс разработки

Проект использует GitFlow:

- `main` — стабильное состояние, изменения только через Pull Request.
- `develop` — интеграционная ветка.
- `feature/<issue>-<description>`, `bugfix/<issue>-<description>`, `release/<version>`, `hotfix/<issue>-<description>`.

Требования:

- каждая значимая работа регистрируется Issue;
- коммиты оформляются по Conventional Commits;
- PR ссылается на Issue и проходит review и CI;
- архитектурные решения фиксируются в [docs/adr/](docs/adr/);
- документация обновляется вместе с кодом.

Планирование, поля и статусы задач ведутся в [GitHub Project](https://github.com/orgs/DrRocksoDevelopment/projects/6); описание процесса — в [docs/PROJECT_MANAGEMENT.md](docs/PROJECT_MANAGEMENT.md). Общие вопросы и идеи — в [GitHub Discussions](https://github.com/DrRocksoDevelopment/persephone/discussions).

Подробности — в [AGENTS.md](AGENTS.md).

## Дорожная карта

Stage 0 реализован и ожидает слияния. Следующий этап — Stage 1: Users & Library. Полный план: [ROADMAP.md](ROADMAP.md).

## Лицензия

Лицензия пока не выбрана. До её утверждения проект является частным и не распространяется на условиях открытой лицензии.
