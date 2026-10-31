# Development Status

**Проект:** Persephone Music
**Обновлено:** 2026-10-31
**Текущий этап:** Stage 0 — Infrastructure MVP (инициализация)

Документ отражает **фактическое** состояние. Наличие файла или документа не означает, что функциональность реализована.

## Implemented

| Область | Что сделано |
|---|---|
| Документация | `PROJECT_SPEC.md`, `ARCHITECTURE.md`, `ROADMAP.md`, `AGENTS.md` |
| Модель данных | Концептуальная модель в `docs/DATA_MODEL.md` (без SQL-миграций) |
| Интеграции | Описание контрактов в `docs/INTEGRATIONS.md` (без кода) |
| Безопасность | Требования в `docs/SECURITY.md` (без реализации) |
| Движки | Проектные документы `RECOMMENDATION_ENGINE.md`, `PREFETCH_ENGINE.md` |
| Архитектурные решения | ADR 0001–0005 |
| Процесс | GitFlow, Issue/PR-шаблоны, Labels, Milestones, Issues #1–#6 |
| Структура репозитория | Каталоги `app/`, `web/`, `scripts/`, `docs/` зарезервированы |

## Tested

| Проверка | Результат |
|---|---|
| Внутренние ссылки документации | Проверены вручную |
| Отсутствие секретов в репозитории | Проверено: `.env` отсутствует, в `.env.example` только заглушки |
| Git-история и ветки | Проверены после первой публикации |
| Код, миграции, CI | Не применимо: кода ещё нет |

## Partially implemented

Нет.

## Planned

| Область | Задача |
|---|---|
| Docker Compose | [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2) |
| API и Worker | [#3](https://github.com/DrRocksoDevelopment/persephone/issues/3) |
| Миграции и схема БД | [#4](https://github.com/DrRocksoDevelopment/persephone/issues/4) |
| CI и проверки качества | [#5](https://github.com/DrRocksoDevelopment/persephone/issues/5) |
| Секреты и конфигурация | [#6](https://github.com/DrRocksoDevelopment/persephone/issues/6) |

## Not implemented

Следующие компоненты отсутствуют полностью:

- HTTP API и маршруты;
- процесс Worker и очереди BullMQ;
- Docker Compose и Dockerfile;
- PostgreSQL-схема и миграции;
- аутентификация, регистрация, сессии;
- музыкальный каталог, индексатор, MusicBrainz matching;
- воспроизведение, HTTP Range, playback sessions;
- интеграция Last.fm и скробблинг;
- плейлисты, очереди, избранное, пропуски;
- Recommendation Engine и радио;
- Prefetch Engine;
- Web Player;
- Subsonic API;
- CI, тесты, линтер.

## Known limitations

- Репозиторий не содержит запускаемого приложения.
- `.env.example` описывает целевые переменные; приложение их пока не читает.
- Схема БД существует только как документация.
- Branch protection и обязательные CI-проверки не настроены: CI ещё нет, а защита приватных репозиториев зависит от тарифа GitHub.
- GitHub Project [#6](https://github.com/orgs/DrRocksoDevelopment/projects/6) настроен: доска, поля Stage/Priority/Work Type/Component/Estimate, 6 Issues, Milestones.
- Представления Table/Roadmap и встроенные Workflows создаются в UI: публичный API GitHub не управляет ими.

## Next step

Выполнить [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2)–[#6](https://github.com/DrRocksoDevelopment/persephone/issues/6) в порядке зависимостей:

1. `#6` — конфигурация и секреты.
2. `#4` — миграции и схема.
3. `#3` — API и Worker.
4. `#2` — Docker Compose.
5. `#5` — CI.

После этого обновить этот документ и закрыть Stage 0.
