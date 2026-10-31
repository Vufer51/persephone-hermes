# Tasks

**Проект:** Persephone Music
**Обновлено:** 2026-10-31
**Источник истины по задачам:** [GitHub Issues](https://github.com/DrRocksoDevelopment/persephone/issues)

Этот файл — краткая сводка. Подробные требования, критерии приёмки и обсуждение находятся в Issues.

## Stage 0 — Infrastructure MVP

| # | Задача | Статус | Зависимости |
|---|---|---|---|
| [#1](https://github.com/DrRocksoDevelopment/persephone/issues/1) | Bootstrap: документация, структура, GitFlow | Done | — |
| [#6](https://github.com/DrRocksoDevelopment/persephone/issues/6) | Секреты и конфигурация окружения | Ready | #1 |
| [#4](https://github.com/DrRocksoDevelopment/persephone/issues/4) | Миграции и начальная схема БД | Ready | #1 |
| [#3](https://github.com/DrRocksoDevelopment/persephone/issues/3) | API и Worker с health checks | Ready | #1, #6 |
| [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2) | Docker Compose stack | Ready | #1, #3, #4 |
| [#5](https://github.com/DrRocksoDevelopment/persephone/issues/5) | CI и проверки качества | Ready | #3, #4 |

**Рекомендуемый порядок:** #6 → #4 → #3 → #2 → #5.

## Definition of Done для Stage 0

- [ ] `docker compose up -d` поднимает PostgreSQL, Redis, Navidrome, Lidarr, API, Worker.
- [ ] API отвечает на `live` и `ready` health checks.
- [ ] Worker подключается к БД и Redis и корректно завершается.
- [ ] Миграции применяются на пустой базе одной командой.
- [ ] Схема БД соответствует `docs/DATA_MODEL.md`.
- [ ] В репозитории нет секретов.
- [ ] CI зелёный на `develop`.
- [ ] README содержит проверенные команды запуска.
- [ ] `DEVELOPMENT_STATUS.md` обновлён.

## Backlog (после Stage 0)

Задачи ещё не оформлены как Issues, так как относятся к следующим этапам:

- регистрация, вход, сессии (Stage 1);
- storage roots и индексатор файлов (Stage 1);
- MusicBrainz matching (Stage 1);
- playback adapter и HTTP Range (Stage 2);
- Last.fm OAuth и scrobble queue (Stage 3);
- избранное, пропуски, плейлисты (Stage 4);
- Recommendation Engine (Stage 5);
- Prefetch Engine (Stage 6);
- Web Player (Stage 7);
- Subsonic API (Stage 8).

Перед началом этапа задачи оформляются отдельными Issues с критериями приёмки.

## Технический долг

Пока не зафиксирован. При появлении оформляется отдельным Issue с label `type: refactor`.
