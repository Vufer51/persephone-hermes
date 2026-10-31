# app — backend Persephone Music

**Статус:** каталог зарезервирован. Рабочего кода пока нет: API, Worker, миграции и тесты появятся в задачах [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2)–[#6](https://github.com/DrRocksoDevelopment/persephone/issues/6).

Backend — модульный монолит на Node.js 22 LTS (JavaScript, ESM). API и Worker используют общий код, но запускаются отдельными процессами.

## Планируемая структура

```text
app/
├── package.json
├── Dockerfile
├── eslint.config.js
├── vitest.config.js
└── src/
    ├── api/
    │   ├── routes/          # HTTP-маршруты
    │   ├── middleware/      # аутентификация, ошибки, request id
    │   ├── app.js           # сборка Fastify
    │   └── server.js        # запуск API
    ├── modules/
    │   ├── auth/
    │   ├── users/
    │   ├── library/
    │   ├── playback/
    │   ├── playlists/
    │   ├── recommendations/
    │   ├── lastfm/
    │   └── prefetch/
    ├── integrations/
    │   ├── navidrome/
    │   ├── lidarr/
    │   ├── lastfm/
    │   └── musicbrainz/
    ├── workers/
    │   ├── worker.js
    │   └── processors/
    ├── db/
    │   ├── migrations/
    │   ├── queries/
    │   ├── migrate.js
    │   └── pool.js
    ├── services/
    ├── config/
    └── utils/
```

## Правила

1. Бизнес-логика не размещается в HTTP-маршрутах: маршрут вызывает модуль/сервис.
2. Модуль не импортирует внутренности другого модуля.
3. Внешние сервисы доступны только через адаптеры `integrations/`.
4. SQL — только в `db/queries/` или миграциях, не в маршрутах.
5. Конфигурация — только через `config/`, с валидацией при старте.
6. Секреты не логируются и не возвращаются API.
7. Каждая пользовательская операция проверяет владельца ресурса.
8. Все изменения схемы — миграциями (см. [ADR 0006](../docs/adr/0006-forward-only-migrations.md)).
9. Ошибки интеграций классифицируются и не превращаются в фиктивные успешные ответы.
10. Тесты обязательны для новой логики.

## Технологии

| Назначение | Технология |
|---|---|
| HTTP | Fastify |
| PostgreSQL | `pg` |
| Redis/очереди | `ioredis`, BullMQ |
| Логирование | `pino` |
| Тесты | Vitest |
| Линтер | ESLint |

## Команды (появятся после реализации)

```bash
npm install
npm run dev:api
npm run dev:worker
npm run migrate
npm run lint
npm test
```

**Сейчас эти команды недоступны:** `package.json` ещё не создан.

## Связанные документы

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [docs/DATA_MODEL.md](../docs/DATA_MODEL.md)
- [docs/INTEGRATIONS.md](../docs/INTEGRATIONS.md)
- [docs/SECURITY.md](../docs/SECURITY.md)
