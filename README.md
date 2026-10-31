# Persephone Music

**Одна музыкальная библиотека — множество независимых музыкальных миров.**

Persephone Music — самостоятельно размещаемая многопользовательская музыкальная платформа: стриминг собственной библиотеки, персональный музыкальный дневник, рекомендательная система и интеллектуальное управление библиотекой.

> **Текущий статус:** инициализация проекта, Stage 0 — Infrastructure MVP.
> Готовы спецификация, архитектурная документация и структура репозитория. Рабочий код, Docker Compose, схема БД, CI ещё не реализованы.
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
├── AGENTS.md               # правила разработки
├── PROJECT_SPEC.md         # спецификация проекта
├── README.md
├── ARCHITECTURE.md
├── ROADMAP.md
├── DEVELOPMENT_STATUS.md
├── TASKS.md
├── CHANGELOG.md
├── .editorconfig
├── .env.example            # шаблон конфигурации (без секретов)
├── .gitignore
│
├── .github/
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── app/                    # backend: API + Worker (структура зарезервирована)
│   ├── README.md
│   └── src/
│       ├── api/
│       │   ├── routes/
│       │   └── middleware/
│       ├── modules/
│       │   ├── auth/
│       │   ├── users/
│       │   ├── library/
│       │   ├── playback/
│       │   ├── playlists/
│       │   ├── recommendations/
│       │   ├── lastfm/
│       │   └── prefetch/
│       ├── integrations/
│       │   ├── navidrome/
│       │   ├── lidarr/
│       │   ├── lastfm/
│       │   └── musicbrainz/
│       ├── workers/
│       ├── db/
│       │   ├── migrations/
│       │   └── queries/
│       ├── services/
│       ├── config/
│       └── utils/
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
├── scripts/                # служебные скрипты (структура зарезервирована)
│   └── README.md
│
└── web/                    # frontend (структура зарезервирована)
    └── README.md
```

Каталоги `app/`, `web/` и `scripts/` пока содержат только README: код появится в задачах Stage 0 ([#2](https://github.com/DrRocksoDevelopment/persephone/issues/2)–[#6](https://github.com/DrRocksoDevelopment/persephone/issues/6)).

## Технологический стек (целевой)

| Компонент | Технология |
|---|---|
| Backend | Node.js 22 LTS |
| Язык | JavaScript, ESM |
| HTTP API | Fastify |
| База данных | PostgreSQL 16 |
| Очереди и кэш | Redis 7, BullMQ |
| Playback | Navidrome (Original First) |
| Управление библиотекой | Lidarr |
| Метаданные | MusicBrainz |
| Персональные музыкальные данные | Last.fm |
| Контейнеризация | Docker Compose |
| Web UI | отдельный frontend-проект |

## Требования (целевые)

- Node.js 22 LTS и npm 10+.
- Docker Engine 24+ и Docker Compose v2.
- PostgreSQL 16 и Redis 7 (в Docker).
- Доступ к Navidrome и Lidarr — собственным или существующим в инфраструктуре пользователя.

## Быстрый старт

**Сейчас недоступен:** запускаемого приложения ещё нет. После выполнения Stage 0 запуск будет выглядеть так:

```bash
git clone https://github.com/DrRocksoDevelopment/persephone.git
cd persephone
cp .env.example .env    # заполнить значения
docker compose up -d
```

Эти команды появятся в README после того, как они будут реально проверены (задачи [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2)–[#6](https://github.com/DrRocksoDevelopment/persephone/issues/6)).

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

Текущий этап — Stage 0. Полный план: [ROADMAP.md](ROADMAP.md).

## Лицензия

Лицензия пока не выбрана. До её утверждения проект является частным и не распространяется на условиях открытой лицензии.
