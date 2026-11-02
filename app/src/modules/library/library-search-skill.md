# Library Search and Browse API (Issue #8)

**Title:** feat(library): search and browse API with artists, recordings, releases
**Stage:** Stage 1 – Users & Library
**Status:** completed

## Context
Full library search and browse API implementation including:
- `searchLibrary()` – полнотекстовый поиск по артистам, записям, релизам, медиа-файлам
- `listArtists()` / `getArtist()` – список и детализация артиста с его записями
- `getRecording()` – детализация записи с медиа-ассетами
- `listReleases()` / `listRecordings()` – списки релизов и записей
- Пагинация через `limit` (макс. 100, дефолт 20) и `offset`
- SQL `LIKE lower($1)` для case-insensitive поиска
- JSON Schema валидации в маршрутах

## Acceptance Criteria
- ✅ `npm test` – 98 passed, 10 skipped
- ✅ `npm run lint` – clean
- ✅ Все 13 интеграционных тестов пройдены
- ✅ Маршруты зарегистрированы в `src/api/app.js`

## Technical Notes
- **Поиск**: SQL `LIKE lower($1)` для case-insensitive поиска по названиям артистов, треков и релизов
- **Пагинация**: `DEFAULT_LIMIT = 20`, `MAX_LIMIT = 100`, передача через querystring
- **Маршруты**: `GET /api/v1/library/search`, `artists`, `artists/:id`, `recordings/:id`, `releases`, `recordings`
- **Валидация**: JSON Schema для querystring параметров в соответствии с требованиями Fastify 5.12.7 (вложенные схемы `querystring: { type: 'object', ... }`)
- **Обработка ошибок**: `catch (_err)` вместо `catch (error)`, блоки вместо однострочных `if return`
- **Маршруты регистрации**: `registerLibraryRoutes(app)` в иерархии `src/api/app.js`

## Technical Notes (Details)
- **Fastify 5.12.7** требует вложенных схем (`querystring: { type: 'object', ... }`)
- **Обработка ошибок**: `catch (_err)` вместо `catch (error)` и блоки вместо однострочных `if return`
- **Маршруты**: `registerLibraryRoutes(app)` в иерархию маршрутов `src/api/app.js`
- **Тесты**: 13 интеграционных тестов в `test/routes-library.test.js`, моки `pool.query` и `redis`, `app.inject`

## Skills Related
- `library-search-service.js` — служба поиска и списков
- `library-search.js` — маршруты API с валидацией
- `media-indexer-service.js` — служба индексации медиа (Issue #6, уже закрыт)
- `musicbrainz-client.js` — клиент MusicBrainz API (Issue #7)
- `recording-matcher.js` — совместитель recorder с MusicBrainz (Issue #7)

## Definition of Done (for this skill)
- All acceptance criteria met
- Lint clean
- Tests passing
- Code follows Fastify 5 conventions
- JSON Schema validation correct
- Error handling follows project conventions
- Routes registered in app.js
EOF