# Project Management

**Проект:** Persephone Music
**GitHub Project:** <https://github.com/orgs/DrRocksoDevelopment/projects/6>
**Репозиторий:** <https://github.com/DrRocksoDevelopment/persephone>

---

## 1. Роль GitHub в процессе

GitHub — центральная система управления разработкой:

- Issues — источник истины по задачам;
- Project — планирование и текущее состояние;
- Milestones — этапы Roadmap;
- Labels — классификация;
- Pull Requests — изменения и review;
- Actions — автоматические проверки;
- Releases/Tags — версии.

Личные заметки и чат не заменяют Issue.

## 2. Поля Project

| Поле | Назначение | Значения |
|---|---|---|
| Status | Текущее состояние | Backlog, Ready, In Progress, Review, Testing, Blocked, Done |
| Stage | Этап Roadmap | Stage 0 — Infrastructure MVP … Stage 8 — Extensions |
| Priority | Приоритет | P0 Critical, P1 High, P2 Normal, P3 Low |
| Work Type | Тип работы | Feature, Bug, Refactor, Documentation, Infrastructure, Security, Performance, Research |
| Component | Основной компонент | API, Database, Auth, Library, Playback, Last.fm, MusicBrainz, Recommendations, Prefetch, Web, Docker, Worker, Repository, CI |
| Estimate | Оценка трудоёмкости | число (относительные пункты) |
| Milestone | Этап релиза | встроенное поле GitHub |
| Labels / Assignees | Классификация и исполнитель | встроенные поля |

Примечание: поле называется **Work Type**, потому что имя `Type` зарезервировано GitHub для типов Issues.

## 3. Статусы и переходы

```text
Backlog → Ready → In Progress → Review → Testing → Done
                     ↓             ↓
                  Blocked      In Progress
```

| Статус | Когда используется |
|---|---|
| Backlog | идея или задача без утверждённого объёма |
| Ready | критерии приёмки ясны, зависимости учтены |
| In Progress | есть назначенный исполнитель и активная работа |
| Review | открыт PR, ожидается проверка |
| Testing | проверка на окружении, миграций, интеграций |
| Blocked | есть внешняя блокировка; причина указана в комментарии |
| Done | критерии приёмки выполнены, PR смержен |

Правила:

- задача не переходит в Ready, пока не сформулированы критерии приёмки;
- Blocked всегда сопровождается комментарием с причиной и условием разблокировки;
- Done означает выполнение Definition of Done, а не «код написан».

## 4. Представления (Views)

Доска **Board** создана по умолчанию. GitHub Projects поддерживает несколько представлений одной доски; публичный API не позволяет создавать их программно, поэтому Table/Roadmap добавляются в интерфейсе.

Рекомендуемые представления:

| Представление | Настройка |
|---|---|
| Board | группировка по Status, сортировка по Priority |
| Table | все поля, группировка по Stage, фильтр по открытым |
| Roadmap | даты Start/Target по этапам (после планирования) |
| My items | фильтр `assignee:@me` |
| Bugs | фильтр `label:"type: bug"` |
| Stage 0 | фильтр `Stage:"Stage 0 - Infrastructure MVP"` |

Как добавить: Project → **+ New view** → выбрать Table/Roadmap → настроить группировку, сортировку и фильтры. Представления не дублируют Issues: это разные проекции одной доски.

## 5. Автоматизация

Встроенные Workflows GitHub Project настраиваются в интерфейсе (Project → Workflows):

1. **Auto-add to project** — добавлять новые Issues репозитория.
2. **Item closed** — переводить закрытый Issue/PR в Done.
3. **Pull request merged** — переводить связанный Issue в Done.
4. **Code changes requested** — переводить в Review/In Progress.
5. **Item reopened** — возвращать в Ready.

Правила:

- автоматизация не заменяет ручную проверку критериев приёмки;
- при закрытии Issue через PR использовать `Closes #N`;
- если автоматизация ошибочна, статус исправляется вручную с комментарием.

## 6. Labels

Labels дублируют часть полей Project для использования в Issues, поиске и фильтрах.

| Группа | Примеры |
|---|---|
| type | `type: feature`, `type: bug`, `type: refactor`, `type: documentation`, `type: infrastructure`, `type: security`, `type: performance`, `type: research` |
| component | `component: api`, `component: database`, `component: auth`, `component: library`, `component: playback`, `component: lastfm`, `component: musicbrainz`, `component: recommendations`, `component: prefetch`, `component: web`, `component: docker`, `component: worker` |
| priority | `priority: critical`, `priority: high`, `priority: normal`, `priority: low` |
| status | `status: blocked`, `status: needs-discussion`, `status: needs-testing` |

Не создавать синонимичные Labels. Если поле Project и Label расходятся, источником истины считается Issue + комментарий, а расхождение исправляется.

## 7. Milestones

Milestones соответствуют этапам Roadmap:

- Infrastructure MVP;
- Library MVP;
- Playback MVP;
- Last.fm Integration;
- Recommendation Engine;
- Prefetch Engine;
- Web Player;
- Subsonic Compatibility.

Сроки (`due_on`) не устанавливаются без анализа трудоёмкости. Milestone закрывается только после выполнения всех критических задач этапа.

## 8. Жизненный цикл задачи

1. **Идея** → обсуждение в Discussions, если задача ещё не сформирована.
2. **Issue** → шаблон, контекст, критерии приёмки, зависимости.
3. **Triage** → labels, Stage, Priority, Component, Estimate, Milestone.
4. **Ready** → задача готова к работе.
5. **Ветка** → `feature/<issue>-<description>` от `develop`.
6. **PR** → ссылка на Issue, тесты, документация.
7. **Review** → проверка архитектуры, безопасности, тестов.
8. **Merge** → в `develop`; Issue закрывается через PR.
9. **Testing** → проверка на окружении.
10. **Done** → критерии выполнены, документация обновлена.

## 9. Definition of Done

Задача завершена, если:

- выполнены Acceptance Criteria;
- код соответствует архитектуре;
- тесты добавлены или обновлены и проходят;
- миграции подготовлены, если менялась БД;
- документация обновлена;
- нет секретов и случайных файлов;
- PR прошёл проверки и review;
- Issue закрыт через PR или обоснованным способом;
- статус в Project обновлён.

## 10. Регулярный процесс

- Перед началом работы: проверить Issue и зависимости.
- В начале недели: просмотреть Ready и Blocked.
- Перед PR: локальные проверки и `git diff`.
- После merge: обновить статус и документацию.
- В конце этапа: сверить Roadmap, закрыть Milestone, обновить `DEVELOPMENT_STATUS.md`.

## 11. Ограничения текущей настройки

- Table/Roadmap/фильтры создаются в UI: публичный API GitHub не предоставляет управление представлениями.
- Встроенные Workflows создаются в UI по той же причине.
- Branch protection и обязательные проверки зависят от тарифа GitHub и появятся вместе с CI (Issue #5).
- Project создан приватным; видимость можно изменить в настройках, если проект станет публичным.
