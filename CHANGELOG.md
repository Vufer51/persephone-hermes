# Changelog

Формат основан на [Keep a Changelog](https://keepachangelog.com/ru/1.1.0/).
Версионирование — [Semantic Versioning](https://semver.org/lang/ru/).

## [Unreleased]

### Added

- Спецификация проекта `PROJECT_SPEC.md` (версия 0.2).
- Правила разработки `AGENTS.md`.
- Документация: `ARCHITECTURE.md`, `ROADMAP.md`, `DEVELOPMENT_STATUS.md`, `TASKS.md`.
- Документы `docs/DATA_MODEL.md`, `docs/INTEGRATIONS.md`, `docs/SECURITY.md`, `docs/RECOMMENDATION_ENGINE.md`, `docs/PREFETCH_ENGINE.md`.
- ADR 0001–0005: модульный монолит, Original First, PostgreSQL как источник истины, Last.fm для каждого пользователя, абстракция хранилищ.
- Структура каталогов `app/`, `web/`, `scripts/`, `docs/`.
- Шаблон конфигурации `.env.example`, `.gitignore`, `.editorconfig`.
- GitHub Issue/PR-шаблоны, `dependabot.yml`.
- Labels и Milestones для этапов проекта.
- GitHub Project #6: доска, поля Status/Stage/Priority/Work Type/Component/Estimate, README проекта.
- Issues #1–#6 для Stage 0, добавленные в Project с приоритетами и этапами.
- Ветки `main` и `develop`.

### Changed

- `main.md` переименован в `PROJECT_SPEC.md`.
- `AGENTS.MD` переименован в `AGENTS.md`.

### Not yet released

Рабочий код, Docker Compose, схема БД, CI и тесты отсутствуют. Версия `0.1.0` пока не выпускалась.

## [0.1.0] — не выпущено

Первый релиз будет создан после завершения Stage 0.
