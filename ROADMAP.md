# Roadmap

**Проект:** Persephone Music  
**Текущий этап:** Stage 10 — Lidarr авто-скачивание (завершён, влит в develop)  
**Связанные документы:** [PROJECT_SPEC.md](PROJECT_SPEC.md), [TASKS.md](TASKS.md), [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md)

Этапы выполняются последовательно. Переход к следующему этапу возможен только после выполнения критических проверок текущего.

## Stage 0. Infrastructure MVP

**Цель:** запускаемый базовый проект.

- [x] Спецификация и правила разработки
- [x] Структура репозитория и документация
- [x] Labels, Milestones, Issues
- [x] Docker Compose: PostgreSQL, Redis, Navidrome, Lidarr, API, Worker
- [x] Каркас API и Worker, health checks
- [x] Система миграций и начальная схема БД
- [x] Конфигурация окружения и секреты
- [x] CI и проверки качества
- [x] Проверенный запуск с нуля

**Результат:** проект запускается, API и Worker подключаются к инфраструктуре, схема БД соответствует документации.

Issues: [#2](https://github.com/DrRocksoDevelopment/persephone/issues/2), [#3](https://github.com/DrRocksoDevelopment/persephone/issues/3), [#4](https://github.com/DrRocksoDevelopment/persephone/issues/4), [#5](https://github.com/DrRocksoDevelopment/persephone/issues/5), [#6](https://github.com/DrRocksoDevelopment/persephone/issues/6).

## Stage 1. Users & Library

**Цель:** каталог корректно представляет общую библиотеку.

- [x] Регистрация и авторизация
- [x] Пользовательские настройки
- [x] Storage roots
- [x] Музыкальные сущности
- [x] Индексатор файлов и SHA256
- [x] MusicBrainz matching
- [x] Поиск
- [x] Базовые операции с библиотекой

**Результат:** общая библиотека не дублирует файлы, пользовательские данные изолированы.

## Stage 2. Playback

**Цель:** пользователь слушает музыку и видит собственную историю.

- [x] Интеграция с Navidrome
- [x] Получение потока
- [x] HTTP Range и перемотка
- [x] Playback sessions
- [x] История прослушиваний
- [x] Корректный scrobble threshold

**Результат:** воспроизведение оригинальных файлов без транскодирования.

## Stage 3. Last.fm

**Цель:** Last.fm работает независимо для каждого пользователя.

- [x] Привязка аккаунта и авторизация
- [x] Безопасное хранение session key
- [x] Now Playing
- [x] Scrobbling
- [x] Загрузка персональных музыкальных данных
- [x] Очередь повторных отправок

## Stage 4. User Preferences

**Цель:** система накапливает собственные данные о предпочтениях.

- [x] Избранное
- [x] Пропуски
- [x] Предпочтения исполнителей
- [x] История
- [x] Плейлисты
- [x] Персональная очередь

## Stage 5. Recommendation Engine

**Цель:** собственная рекомендательная система.

- [x] Генерация кандидатов
- [x] Similar tracks/artists
- [x] Персональное ранжирование
- [x] Фильтрация
- [x] Разнообразие
- [x] Объяснения рекомендаций
- [x] Радио

## Stage 6. Prefetch Engine

**Цель:** система заранее готовит вероятные следующие композиции.

- [x] Прогноз следующих композиций
- [x] Проверка наличия файлов
- [x] Общие задачи получения контента
- [x] Приоритеты
- [x] Повторные попытки
- [x] Отмена устаревших задач
- [x] Ограничения ресурсов

## Stage 7. Web Player

**Цель:** самостоятельный пользовательский интерфейс.

- [x] API для HTML5 аудио плеера (stream URL)
- [x] Now Playing endpoint
- [x] История воспроизведения
- [x] Список доступных медиа-ассетов
- [x] Subsonic API совместимость (ping, search, albums, artists, playQueue, stream, cover art, scrobble)

**Результат:** веб-плеер доступен через API, Subsonic-клиенты могут подключаться.

## Stage 8. CI/CD Pipeline

**Цель:** автоматизированный контроль качества и доставки.

- [x] GitHub Actions CI: lint, тесты, Docker build, security audit
- [x] GitHub Actions Docker Build: сборка и пуш образа
- [x] GitHub Actions Release: создание релиза на теги
- [x] Issue templates: bug report, feature request
- [x] Pull Request template
- [x] ADR 0005: Web Player и Subsonic API совместимость

**Результат:** полный CI/CD pipeline, репозиторий готов к командной разработке.

## Stage 10. Lidarr авто-скачивание

**Цель:** пользователь видит бесконечную библиотеку — все треки доступны для поиска, скачивание происходит автоматически в фоне.

- [x] Lidarr API клиент (поиск исполнителей, добавление в библиотеку)
- [x] download_requests таблица (отслеживание статуса скачивания)
- [x] Авто-запрос в Lidarr при поиске/воспроизведении недоступного трека
- [x] qBittorrent + Prowlarr в docker-compose
- [x] Скрипт автонастройки (npm run setup)
- [x] API: GET/POST/GET/DELETE /api/v1/downloads/requests, GET /api/v1/downloads/status
- [x] available_locally + download_status в поиске и деталях записи

**Результат:** пользователь видит все треки, скачивание происходит автоматически через Lidarr + qBittorrent без ручного вмешательства.

## Правила планирования

- Задача без Issue не начинается, если она значима.
- Крупная задача делится на связанные Issues.
- Сроки не указываются без анализа трудоёмкости.
- Milestone задачи соответствует этапу Roadmap.
- Статус этапа отражается в [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md).
