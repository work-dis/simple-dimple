# Changelog

Этот файл нужен для краткой хронологии изменений по проекту.

Формат простой:

- дата
- что было сделано
- зачем это было сделано

## 2026-07-07

### Worker execution observability in Ops

Что сделали:

- расширили `GET /api/ops/route-decisions`: теперь рядом с route-quality metrics возвращается `routeReprobeExecution` summary по persisted jobs
- добавили worker/job execution metrics: `queued/running/completed/dead_letter`, `retry/dead-letter/completion rate`, overdue queue, stale running jobs и последние worker timestamps
- добавили timing-метрики по persisted jobs: `timeToStart`, `lifecycle`, `oldest queued`, `longest running`
- `Ops` экран теперь показывает отдельный worker execution dashboard и recent reprobe jobs с коротким attempt-audit drilldown
- зафиксировали новый summary helper unit-тестом на lifecycle/timing/worker-health вычисления

Зачем:

- сделать вынесенный worker не просто отдельным процессом, а реально наблюдаемым через admin surface
- дать быстрый ответ на вопросы "worker жив?", "очередь отстает?" и "jobs умирают в retry/dead-letter или доходят до completion?"
- подготовить следующий шаг к более плотной связке execution metrics с route-quality observation

### Route reprobe worker split into separate process

Что сделали:

- вынесли background polling/execution из `backend/src/server.ts` в отдельный entrypoint `backend/src/worker.ts`
- добавили общий `backend/src/runtime.ts`, чтобы API и worker переиспользовали один и тот же `store + resolveRouteDecision` runtime-контракт
- `npm run dev` теперь поднимает три процесса: `backend`, `worker`, `frontend`; отдельно добавлены `npm run dev:worker` и `npm run start:worker`
- `compose.yaml` теперь умеет поднимать отдельный `route-reprobe-worker` service через профиль `worker`
- синхронизировали README и архитектурные docs с тем, что worker уже физически отделен от API-процесса

Зачем:

- сделать следующий шаг по roadmap не декларацией, а реальным separation boundary для background execution
- убрать polling loop из API lifecycle и подготовить почву под worker-specific observability
- зафиксировать единый runtime-контракт между online route resolution и background re-probe execution

### Route reprobe execution hardening

Что сделали:

- добавили миграцию `20260707143000_route_reprobe_execution_hardening` и расширили `RouteReprobeJob` полями `maxAttempts`, `nextAttemptAt`, `leaseReclaimedCount`, `deadLetteredAt` и `attemptAudit`
- persisted job store теперь сам решает retry lifecycle: очередь учитывает `nextAttemptAt`, stale `running` jobs reclaim-ятся по `leaseExpiresAt`, ошибки переводят job либо в `queued` с backoff, либо в `dead_letter`
- admin enqueue API теперь принимает `maxAttempts`, а `GET /api/ops/route-reprobe-jobs` возвращает уже расширенный execution summary с attempt audit
- добавили тесты на queue failure path и backoff helper, чтобы retry/dead-letter policy была зафиксирована в unit coverage

Зачем:

- убрать implicit retry-логику из памяти процесса и сделать execution policy переживающей рестарты
- явно зафиксировать reclaim/backoff/dead-letter контракт до выноса worker-а в отдельный процесс
- синхронизировать roadmap с реальным состоянием persisted worker execution

### Explainable failure-domain metrics in Ops

Что сделали:

- расширили `GET /api/ops/route-decisions`: поверх текущих `fallback pressure / degradation windows / recovery time` теперь считаются еще и `SLA windows`, `provider pressure`, `ASN pressure` и `recovery by failure domain`
- вынесли расчет route-decision ops summary в отдельный тестируемый helper и добавили unit-тест на новые quality metrics
- усилили безопасный JSON mapping в `route-reprobe-jobs`, чтобы backend `typecheck` снова проходил полностью
- обновили `Ops` экран, чтобы новые explainable metrics были видны без чтения raw event trail

Зачем:

- дать ops-слою следующий roadmap-инкремент не только по времени деградации, но и по failure domains
- сделать pressure и recovery signals объяснимыми на уровне `provider / ASN`, а не только на уровне отдельных endpoint-ов
- синхронизировать код и roadmap так, чтобы следующим реальным шагом уже был worker execution hardening

### Persisted route-reprobe worker and explainable ops metrics

Что сделали:

- применили миграцию `20260707120000_route_reprobe_jobs` и добавили persisted `RouteReprobeJob` lifecycle вместо in-memory очереди
- `GET /api/ops/route-reprobe-jobs` и `POST /api/ops/route-reprobe-jobs` сохранили тот же admin-only API, но теперь работают поверх persisted job store
- backend `route-reprobe` execution перевели на lease-aware polling worker, который claim-ит job, пишет `runtime_reprobe_resolve` snapshot и завершает job уже после записи feedback/results
- `GET /api/ops/route-decisions` теперь реально возвращает `RouteDecisionOpsSummary`, а не общий admin summary
- в `Ops` добавили первые explainable quality metrics поверх persisted trail: `fallback pressure`, `degradation windows`, `recovery time`
- задокументировали новый worker-контур и `route_reprobe_jobs` в архитектурных и schema docs

Зачем:

- убрать последнюю крупную зависимость фоновых route-quality jobs от памяти API-процесса
- сделать execution trail наблюдаемым и переживающим рестарты backend-а
- дать ops-слою не только event feed, но и первые интерпретируемые сигналы о том, как route quality деградирует и восстанавливается

### Background resolve/re-probe workflow baseline

Что сделали:

- привели `POST /api/routes/feedback` в соответствие с docs: backend теперь реально пишет и `route_events`, и зеркальный `probe_report`, чтобы feedback сразу влиял на ranking и `routeHealth`
- `POST /api/telemetry/probe` теперь сохраняет `testedAt`, `appVersion`, `bytesSent` и `bytesReceived`, а не отбрасывает их на входе
- добавили in-memory очередь фоновых `resolve/re-probe` jobs в [backend/src/route-reprobe.ts](/Users/miko/Documents/simple-dimple/backend/src/route-reprobe.ts:1)
- добавили admin-only endpoints `GET /api/ops/route-reprobe-jobs` и `POST /api/ops/route-reprobe-jobs` для запуска и наблюдения фоновых jobs
- background job теперь отдельно пишет `runtime_reprobe_resolve` snapshot в `route_events` и при наличии результатов умеет записывать `runtime_reprobe` feedback вне пользовательского `connect` path

Зачем:

- убрать расхождение между документацией и реальным feedback-loop
- начать следующий roadmap-шаг про фоновые `resolve/re-probe` workflows без смешивания его с основным connect-flow
- дать ops-слою первый наблюдаемый контур для background route-quality перепроверок

### Cross-network learning and telemetry retention

Что сделали:

- добавили `cross-network learning` в backend ranking: `routeRanking` теперь может учитывать ограниченный опыт похожих сетей, а не только exact `networkFingerprint`
- сделали fallback-чтение ranking-ов через наиболее релевантный доступный fingerprint, чтобы `resolve` не ждал полного прогрева exact telemetry
- зафиксировали явные retention windows для telemetry-данных и добавили очистку старых `probeReports`, `routeEvents`, `routeSuccessRollups` и `routeRankings`
- расширили unit-тесты на similarity tiers и retention cutoffs

Зачем:

- начать следующий roadmap-слой не на уровне заметок, а в реальном policy/ranking pipeline
- сделать telemetry полезной даже на похожих сетях при контролируемом уровне доверия
- не накапливать бесконечный telemetry-хвост без понятного retention-контракта

### Docs sync: CI and next roadmap steps

Что сделали:

- синхронизировали [README.md](/Users/miko/Documents/simple-dimple/README.md:1), [docs/ROADMAP.md](/Users/miko/Documents/simple-dimple/docs/ROADMAP.md:1), [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md:1) и [docs/ARCHITECTURE.md](/Users/miko/Documents/simple-dimple/docs/ARCHITECTURE.md:1)
- явно зафиксировали CI-порядок `generate -> migrate -> check -> test -> build`
- единообразно записали ближайшую очередь: `cross-network learning` и retention для telemetry, затем фоновые `resolve/re-probe` workflows, затем `decision observability` и SLA-метрики

Зачем:

- держать документацию в одном состоянии, без конфликтующих "следующих шагов"
- не потерять связь между текущим policy-layer, новым CI и реальным roadmap

### GitHub Actions CI

Что сделали:

- добавили [`.github/workflows/ci.yml`](/Users/miko/Documents/simple-dimple/.github/workflows/ci.yml:1)
- вынесли `prisma generate` в отдельный последовательный CI-шаг
- добавили root-команды `npm run ci:check` и `npm run ci:build`
- добавили `backend`-команды `check:ci`, `build:ci` и `typecheck`
- обновили `README`, `DEV_SETUP` и `DECISIONS`

Зачем:

- убрать гонку между несколькими backend-командами, которые пересоздают `src/generated/prisma`
- сделать CI предсказуемым без изменения удобных локальных сценариев
- явно зафиксировать порядок `generate -> migrate -> check -> test -> build`

### Frontend orchestration split

Что сделали:

- вынесли `auth/account` состояние и handlers из `App.tsx` в `frontend/src/hooks/useAuthAccount.ts`
- вынесли `route/session/connect` flow в `frontend/src/hooks/useRouteSession.ts`
- вынесли admin и ops загрузку в `useAdminUsers.ts` и `useRouteDecisionOps.ts`
- вынесли network helpers и best-effort telemetry submit в `frontend/src/lib/network.ts`
- обновили `DECISIONS` под новую frontend-границу

Зачем:

- сделать `App.tsx` тонким orchestration-слоем вместо очередного фронтенд-монолита
- разделить домены так, чтобы auth, routing и служебные экраны можно было менять независимо
- снизить риск регрессий при следующих изменениях в account/admin/ops flows

## 2026-07-06

### Admin-gated ops access

Что сделали:

- добавили флаг `isAdmin` в `User` и отдельную migration
- закрыли `GET /api/ops/route-decisions` через backend-проверку admin-доступа
- спрятали `Ops` для обычного пользователя и начали явно показывать admin-статус в `Account`

Зачем:

- сделать observation/ops слои реально служебными, а не просто условно скрытыми
- отделить пользовательский UX от служебного без преждевременного RBAC-комбайна

### Admin user management screen

Что сделали:

- добавили `GET /api/admin/users` и `PATCH /api/admin/users/:userId`
- добавили отдельный экран `Admin` для выдачи и снятия admin-флага без ручной правки БД
- запретили снимать admin-флаг с последнего администратора
- обновили `README`, `DEV_SETUP`, `ROADMAP`, `ARCHITECTURE` и `DB_SCHEMA`

Зачем:

- убрать ручное назначение админов через сиды или SQL
- зафиксировать admin-доступ как управляемую часть dev-стенда, а не как скрытую договоренность

### Initial dev foundation

Что сделали:

- создали монорепо-структуру с `backend` и `frontend`
- добавили корневой `package.json` с workspace-скриптами
- подняли локальный backend на `Fastify`
- подняли локальный frontend на `React + Vite`
- добавили PWA-конфигурацию через `vite-plugin-pwa`
- реализовали тестовый сценарий `Подключить / Отключить`
- реализовали переключение тестового сервера
- настроили frontend proxy на backend
- добавили `.gitignore`

Зачем:

- получить минимальный рабочий контур для проверки UX и прикладной логики
- отделить стартовый dev-стенд от будущей полной VPN-инфраструктуры

### Documentation baseline

Что сделали:

- обновили [README.md](/Users/miko/Documents/simple-dimple/README.md)
- добавили [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md)
- добавили этот `CHANGELOG`
- добавили `DECISIONS` для фиксации ключевых решений

Зачем:

- вести проект так, чтобы текущее состояние, история и мотивация решений не терялись

### Home and Server split

Что сделали:

- убрали список серверов с главного экрана
- разделили пользовательский UI на `Home` и `Server`
- оставили на `Home` только статус, большую кнопку `Подключить` и переход к серверу
- синхронизировали `README`, `ROADMAP`, `ARCHITECTURE` и `DEV_SETUP` с новым состоянием UI

Зачем:

- продолжить roadmap без возврата к dashboard-паттерну
- зафиксировать, что второй пользовательский сценарий должен жить отдельно от главной кнопки
- убрать расхождение между документацией и реальным стеком frontend

### Account screen baseline

Что сделали:

- добавили отдельный экран `Account`
- вынесли туда тариф, контакт, продление и устройства как служебные пользовательские данные
- оставили `Home` сфокусированным на подключении, а `Server` и `Account` сделали вспомогательными разделами
- обновили `README`, `PRODUCT`, `ROADMAP`, `ARCHITECTURE` и `DEV_SETUP`

Зачем:

- закрепить целевую трехэкранную модель `Home / Server / Account`
- не смешивать ежедневное подключение с аккаунт-деталями
- продолжить roadmap и одновременно пометить изменения в документации

### Account API wiring

Что сделали:

- добавили backend endpoint `GET /api/account`
- убрали account-заглушку из frontend и перевели экран `Account` на данные из API
- добавили в account-сводку статус подписки и дату начала использования
- обновили `README`, `DEV_SETUP` и `ARCHITECTURE`

Зачем:

- перевести `Account` с декоративного состояния на реальный data flow
- подготовить понятную точку входа для будущих `auth/users/subscriptions`
- продолжить план без раннего усложнения полной auth-инфраструктурой

### Account contact update

Что сделали:

- добавили первый write-flow для `Account`, позже переведенный на `PATCH /api/account/profile`
- дали экрану `Account` возможность редактировать и сохранять контакт через backend
- сохранили UX простым: одно поле, одно действие, без лишней формы
- обновили `README`, `DEV_SETUP` и `ARCHITECTURE`

Зачем:

- сделать `Account` не только читающим, но и базово управляемым экраном
- продолжить движение к реальным `user/account` сущностям
- проверить полезный write-flow до появления полной auth-схемы

### Account entities baseline

Что сделали:

- выделили в backend отдельные сущности `user`, `subscription` и `devices`
- перевели `Account` на более реалистичную структуру данных вместо плоской сводки
- расширили edit-flow до обновления профиля пользователя, а не только контакта
- обновили `README`, `DEV_SETUP` и `ARCHITECTURE`

Зачем:

- подготовить нормальную модель данных до подключения БД и auth
- продолжить план в сторону реальных пользовательских сущностей
- не застревать на декоративном account-слое

### File-backed dev persistence

Что сделали:

- добавили локальное файловое хранилище `backend/data/app-state.json`
- backend теперь читает `session` и `account` на старте и сохраняет их после изменений
- убрали раздражающий сброс данных после каждого перезапуска dev-сервера
- обновили `README`, `DEV_SETUP`, `ROADMAP` и `ARCHITECTURE`

Зачем:

- сделать dev-стенд ближе к реальному поведению без раннего подключения БД
- пройти промежуточный шаг между pure in-memory state и полноценным persistence-слоем
- продолжить план поэтапно и без лишнего инфраструктурного скачка

### PostgreSQL schema draft

Что сделали:

- добавили [docs/DB_SCHEMA.md](/Users/miko/Documents/simple-dimple/docs/DB_SCHEMA.md) с черновой целевой схемой под `PostgreSQL`
- отдельно зафиксировали слои `core`, `telemetry`, `analytics` и `ops`
- описали, как разделять `clients` и client reports, какие таблицы нужны и какой retention нужен telemetry
- связали новый документ с `README`, `ARCHITECTURE` и `ROADMAP`

Зачем:

- заранее выбрать достаточно сильную и правильную модель хранения для будущего продакшн-сервера
- не смешать user/account данные и network reports
- подготовить нормальную базу под auth, ranking и telemetry

### Prisma and PostgreSQL backend scaffold

Что сделали:

- добавили `Prisma` в `backend`
- завели [backend/prisma/schema.prisma](/Users/miko/Documents/simple-dimple/backend/prisma/schema.prisma:1), [backend/prisma.config.ts](/Users/miko/Documents/simple-dimple/backend/prisma.config.ts:1) и initial migration
- добавили storage abstraction с режимами `file / prisma / auto`
- подключили `Prisma + PostgreSQL` store для `session` и `account`, сохранив file-backed fallback для локальной разработки без БД
- обновили `README`, `DEV_SETUP`, `ROADMAP`, `ARCHITECTURE` и `DB_SCHEMA`

Зачем:

- перейти от абстрактного плана БД к реальному backend-каркасу
- подготовить мягкий переход с file-backed dev-стенда на `PostgreSQL`
- не ломать текущий темп разработки, пока реальная БД ещё не поднята

### PostgreSQL-only runtime

Что сделали:

- добавили [compose.yaml](/Users/miko/Documents/simple-dimple/compose.yaml:1) для локального `PostgreSQL`
- добавили root-скрипты `db:up`, `db:down`, `db:logs`, `db:migrate`
- перевели backend runtime на обязательный `Prisma + PostgreSQL` без file-backed fallback
- обновили [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1), [README.md](/Users/miko/Documents/simple-dimple/README.md:1), [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md:1), [docs/ARCHITECTURE.md](/Users/miko/Documents/simple-dimple/docs/ARCHITECTURE.md:1), [docs/ROADMAP.md](/Users/miko/Documents/simple-dimple/docs/ROADMAP.md:1), [docs/DECISIONS.md](/Users/miko/Documents/simple-dimple/docs/DECISIONS.md:1) и [docs/DB_SCHEMA.md](/Users/miko/Documents/simple-dimple/docs/DB_SCHEMA.md:1)

Зачем:

- сделать локальный DB-старт одной воспроизводимой командой
- убрать расхождение между runtime и migration flow
- закрепить базу для следующего слоя с auth и server-domain сущностями

### Auth foundation and DB wait flow

Что сделали:

- добавили DB-backed `AuthSession` и новую migration для auth foundation
- перевели auth flow на `GET /api/auth/session`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`
- научили `Account`-экран переживать signed-out состояние и принимать пару `логин/пароль` без подтверждения email
- добавили [backend/scripts/wait-for-db.mjs](/Users/miko/Documents/simple-dimple/backend/scripts/wait-for-db.mjs:1) и root-скрипт `db:wait`
- обновили [README.md](/Users/miko/Documents/simple-dimple/README.md:1), [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md:1), [docs/ARCHITECTURE.md](/Users/miko/Documents/simple-dimple/docs/ARCHITECTURE.md:1), [docs/PRODUCT.md](/Users/miko/Documents/simple-dimple/docs/PRODUCT.md:1), [docs/ROADMAP.md](/Users/miko/Documents/simple-dimple/docs/ROADMAP.md:1), [docs/DECISIONS.md](/Users/miko/Documents/simple-dimple/docs/DECISIONS.md:1) и [docs/DB_SCHEMA.md](/Users/miko/Documents/simple-dimple/docs/DB_SCHEMA.md:1)

Зачем:

- превратить “добавить auth” из пункта плана в рабочий backend/frontend baseline
- убрать гонку старта между backend и `PostgreSQL`
- сохранить дальнейший roadmap привязанным к уже работающему контракту, а не к абстрактной идее

### Password auth for test stage

Что сделали:

- добавили [backend/prisma/migrations/20260706174000_password_auth/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706174000_password_auth/migration.sql:1) и [backend/prisma/migrations/20260706174500_auth_provider_credentials_cleanup/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706174500_auth_provider_credentials_cleanup/migration.sql:1)
- ввели `PasswordCredential`, `credentials` provider и seed-аккаунт `demo / change-me`
- дали backend возможность регистрировать тестовый аккаунт и входить по паре `логин/пароль` без `email confirmation`
- обновили frontend `Account`, чтобы он поддерживал `login`, `register` и `logout` без возврата к dev-only кнопке

Зачем:

- сделать тестовый auth реалистичнее, чем `dev-login`, но без преждевременного усложнения подтверждением email
- оставить прямой путь к будущему `email verification` и `Telegram auth`

### Verification-code auth foundation

Что сделали:

- добавили [backend/prisma/migrations/20260706190000_verification_challenges/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706190000_verification_challenges/migration.sql:1) и сущность `VerificationChallenge`
- добавили backend endpoints `POST /api/auth/challenge` и `POST /api/auth/verify` для `email` и `Telegram`
- расширили `Account`, чтобы dev-стенд умел входить по verification-коду поверх текущего `login/password` flow
- сделали локальный verification-flow self-contained: код сразу показывается в UI без внешнего SMTP или Telegram-бота

Зачем:

- продолжить план в сторону `email verification` и `Telegram auth`, не упираясь в внешние интеграции слишком рано
- зафиксировать общий challenge-based контракт, на который потом можно посадить реальную доставку кодов

### Server pools and endpoints foundation

Что сделали:

- добавили [backend/prisma/migrations/20260706194000_server_pools_and_endpoints/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706194000_server_pools_and_endpoints/migration.sql:1)
- ввели в `Prisma` модели `ServerPool` и `Endpoint`
- перевели backend-выдачу списка серверов с hardcoded-константы на DB-backed каталог
- засидили три независимых dev-пула и их endpoint-ы, сохранив текущий простой `Server` UX

Зачем:

- закрыть следующий пункт roadmap после базовых `users/subscriptions/devices`
- подготовить реальную server-domain основу под telemetry, ranking и multi-path routing

### Telemetry probe baseline

Что сделали:

- добавили [backend/prisma/migrations/20260706200000_network_fingerprints_and_probe_reports/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706200000_network_fingerprints_and_probe_reports/migration.sql:1)
- ввели `NetworkFingerprint` и `ProbeReport` в `Prisma/PostgreSQL`
- добавили backend endpoint `POST /api/telemetry/probe`
- подключили best-effort отправку probe report из frontend после успешного подключения и при смене сервера в активной сессии

Зачем:

- перейти от абстрактного telemetry-плана к реальному сырому слою client probes
- подготовить базу под `route_success_rollups`, ranking и multi-path routing без перегруза текущего UI

### Analytics rollups and ranking skeleton

Что сделали:

- добавили [backend/prisma/migrations/20260706203000_route_rollups_and_rankings/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706203000_route_rollups_and_rankings/migration.sql:1)
- ввели `RouteSuccessRollup` и `RouteRanking` в `Prisma/PostgreSQL`
- после каждого нового `probe report` backend теперь пересчитывает 24-часовой rollup и ranking для соответствующего `network fingerprint`
- выдача `GET /api/session` теперь умеет учитывать накопленный ranking по coarse network context и переупорядочивать кандидатов серверов

Зачем:

- превратить telemetry из “сырая история” в уже работающий ranking input
- начать реальное движение к shortlist-модели выдачи маршрутов без усложнения пользовательского интерфейса

### Endpoint assignment baseline

Что сделали:

- добавили [backend/prisma/migrations/20260706210000_user_endpoint_assignments/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706210000_user_endpoint_assignments/migration.sql:1)
- ввели `UserEndpointAssignment` в `Prisma/PostgreSQL`
- backend теперь пишет assignment при ручном выборе сервера и при успешном `connect` для авторизованного пользователя
- `GET /api/session` теперь возвращает текущий assignment, а frontend показывает его как служебную мета-информацию

Зачем:

- backend уже записывает assignment при `connect` и ручном выборе сервера
- следующий логичный слой теперь более явный shortlist/policy-engine flow и `last-known-good route`

## 2026-07-06 (later)

### Explicit route feedback API and persisted route events

Что сделали:

- добавили `RouteEvent` в [backend/prisma/schema.prisma](/Users/miko/Documents/simple-dimple/backend/prisma/schema.prisma:252) и миграцию [backend/prisma/migrations/20260707001500_route_events_and_feedback/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260707001500_route_events_and_feedback/migration.sql:1)
- добавили `POST /api/routes/feedback` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- `recordRouteFeedback()` в [backend/src/state-store.ts](/Users/miko/Documents/simple-dimple/backend/src/state-store.ts:1) теперь пишет и `route_events`, и зеркальный `probe_report`, чтобы feedback сразу влиял на ranking и `routeHealth`
- ввели отдельные типы `RouteFeedbackBody`, `RouteFeedbackResult` и `RouteFeedbackSource` в [backend/src/types.ts](/Users/miko/Documents/simple-dimple/backend/src/types.ts:1)

Зачем:

- теперь у нас есть явный feedback-контракт поверх `routes/resolve`, а не только косвенный сигнал через probe telemetry
- quality loop для route decisions стал замкнутым: feedback не только логируется, но и реально влияет на следующие resolve-решения

### Dedicated `POST /api/routes/resolve` contract

Что сделали:

- добавили отдельный `POST /api/routes/resolve` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- вынесли общую resolve-логику в единый helper, который теперь переиспользуют `GET /api/session`, `POST /api/connect` и `POST /api/server`
- новый endpoint возвращает `routePolicy`, `routeHealth`, `currentAssignment`, `lastKnownGoodRoute` и опционально `servers`
- добавили `manualEndpointId` для side-effect-free preview manual override без записи assignment

Зачем:

- route decision больше не размазан по нескольким HTTP-роутам как побочный эффект session/connect flow
- это даёт более чистый контракт для первых production-клиентов и снижает риск расхождения логики при росте нагрузки и числа consumers

### Probe failure taxonomy and freshness-weighted ranking penalties

Что сделали:

- добавили `failureReason` в `ProbeReport` через [backend/prisma/migrations/20260706234500_probe_failure_reasons/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706234500_probe_failure_reasons/migration.sql:1)
- расширили `TelemetryProbeBody` и валидацию `POST /api/telemetry/probe` в [backend/src/types.ts](/Users/miko/Documents/simple-dimple/backend/src/types.ts:1) и [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- ranking в [backend/src/state-store.ts](/Users/miko/Documents/simple-dimple/backend/src/state-store.ts:1) теперь учитывает не только `success_rate / disconnect_rate / latency`, но и свежесть probe-а, тяжесть `failureReason` и силу накопленного сигнала
- hard `degraded`-avoidance тоже стал уже осторожнее: endpoint уходит в avoid-list только при более явной серии свежих тяжёлых fail-сигналов

Зачем:

- нам нужен путь от грубого `avoid degraded` к penalty-модели, где свежий `timeout` и старый единичный fail влияют по-разному
- shortlist должен уметь мягко понижать маршрут раньше, чем мы совсем исключим его из candidate pool

### Route health snapshots and explainable policy penalties

Что сделали:

- заменили прямое чтение `getDegradedEndpointIds()` на `getRouteHealthSnapshots()` в [backend/src/state-store.ts](/Users/miko/Documents/simple-dimple/backend/src/state-store.ts:1)
- backend теперь возвращает `routeHealth` рядом с `routePolicy` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- `buildRoutePolicy()` в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) теперь принимает snapshots, сам выделяет `avoid`-кандидатов и заполняет explainability-поля по penalty reason / confidence / health status
- frontend показывает health-мету и топ penalized маршруты в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1)

Зачем:

- policy должен видеть не только binary avoid-list, но и нормальный route-health слой с penalty, confidence и dominant failure reason
- это подготавливает следующий шаг к более умному candidate selection без превращения scoring в непрозрачную магию

### Health-aware shortlist selection for fallback candidates

Что сделали:

- `buildRoutePolicy()` в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) теперь выбирает `transport/provider/asn` fallback-кандидатов не по первому совпадению, а по лучшему совпадению с учётом `routeHealth`
- при выборе `#2/#3/#4` policy теперь предпочитает `healthy` endpoints, затем слабее penalized, и только потом тяжело penalized/`avoid` fallback-пути
- в `routePolicy.trace` добавили `usedHealthAwareShortlist` и `shortlistPenalizedCount`
- frontend показывает эту мету на server-экране в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1)

Зачем:

- shortlist должен быть не просто diversity-aware, но и health-aware внутри каждого fallback-слота
- это снижает шанс, что policy выберет формально “другой ASN”, который уже выглядит хуже по свежей probe telemetry

### Health-aware primary selection for top candidate demotion

Что сделали:

- `buildRoutePolicy()` в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) теперь умеет понижать исходный primary-кандидат, если свежий `routeHealth` уже достаточно уверенно показывает более плохое состояние, а рядом есть заметно healthier endpoint
- это правило не ломает `manual override`, а для остальных случаев оставляет trace о том, какой primary был изначально и на какой endpoint policy переключился
- в `routePolicy.trace` добавили `usedHealthAwarePrimarySelection`, `primaryCandidate*` и `healthAdjustedPrimaryEndpointId`
- frontend показывает эту служебную мету на server-экране в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1)

Зачем:

- даже хороший ranking или старый `last-known-good` не должны упрямо оставаться primary, если свежая probe telemetry уже говорит, что соседний маршрут выглядит безопаснее
- при этом demotion должен происходить только при достаточно сильном сигнале, чтобы policy не дёргался от случайного единичного fail

### Degraded-route feedback loop: policy временно избегает свежих problem endpoints

Что сделали:

- добавили `getDegradedEndpointIds()` в [backend/src/state-store.ts](/Users/miko/Documents/simple-dimple/backend/src/state-store.ts:1)
- policy теперь смотрит на свежие `probe_reports` за последний час по текущему `network fingerprint`
- если у endpoint есть серия недавних неуспешных результатов без свежего success, `routePolicy` старается исключить его из основного candidate pool
- в `routePolicy.trace` добавили `usedDegradedAvoidance` и `degradedEndpointCount`
- frontend показывает эту служебную мету на server-экране в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1)

Зачем:

- ranking и shortlist не должны упрямо продолжать предлагать маршрут, который только что несколько раз подряд упал на похожей сети
- это даёт быстрый feedback-loop без новой БД-схемы и без отдельного feedback API

### Failure-domain diversity: shortlist стал жестче к дубликатам provider/ASN/IP

Что сделали:

- расширили `ServerOption` и `RoutePolicyCandidate` полями `asn` и `ipAddress` в [backend/src/types.ts](/Users/miko/Documents/simple-dimple/backend/src/types.ts:1)
- `buildRoutePolicy()` в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) теперь старается выбирать diagnostic/diversity fallback-кандидатов из других failure domains
- добавили `asn_diversity_fallback` и trace-метрики `diversityStageReached`, `shortlistDistinctProviders`, `shortlistDistinctAsns`
- frontend показывает эту diversity-мету на server-экране в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1)

Зачем:

- shortlist не должен выглядеть разнообразным только по label, оставаясь внутри одного и того же failure domain
- policy-engine теперь лучше соблюдает логику roadmap про независимые fallback-пути по `provider / ASN / IP`

### Policy trace: компактная explainability metadata в routePolicy

Что сделали:

- расширили `RoutePolicySummary` в [backend/src/types.ts](/Users/miko/Documents/simple-dimple/backend/src/types.ts:1) полем `trace`
- `buildRoutePolicy()` в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) теперь возвращает `selectedBy`, `usedManualOverride`, `usedLastKnownGood`, `usedNetworkRanking` и `fallbackTier`
- frontend показывает эту служебную policy-мету на server-экране в [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1) без перегруза главного UX

Зачем:

- policy-engine теперь можно отлаживать без гаданий, почему был выбран именно этот кандидат
- explainability осталась внутренней и компактной, без превращения приложения в diagnostic dashboard

### Last-known-good routes: persisted success-state для policy-engine

Что сделали:

- добавили [backend/prisma/migrations/20260706223000_last_known_good_routes/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260706223000_last_known_good_routes/migration.sql:1)
- ввели `LastKnownGoodRoute` в `Prisma/PostgreSQL`
- добавили `getLastKnownGoodRoute()` и `recordLastKnownGoodRoute()` в [backend/src/state-store.ts](/Users/miko/Documents/simple-dimple/backend/src/state-store.ts:1)
- `POST /api/connect` теперь после успешного подключения пишет отдельную `last-known-good` запись с `network fingerprint` и TTL
- `routePolicy` теперь берет `last_known_good` из persisted success-state, а не выводит его из текущего assignment

Зачем:

- `UserEndpointAssignment` хранит факт выдачи маршрута, но не является надежным источником “последнего действительно рабочего пути”
- policy-engine нужен отдельный success-layer, который можно валидировать по сети и времени
- это готовит основу под следующий шаг с `decision trace` и более точным fallback behavior

### Policy engine: вынесли decision logic в отдельный модуль

Что сделали:

- добавили [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1) как отдельный модуль для `normalizeTelemetryContext()`, `hasTelemetryContext()` и `buildRoutePolicy()`
- убрали shortlist/policy helpers из [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1), оставив в роутере только orchestration вокруг store и API-ответа
- синхронизировали [README.md](/Users/miko/Documents/simple-dimple/README.md:1), [docs/ROADMAP.md](/Users/miko/Documents/simple-dimple/docs/ROADMAP.md:1), [docs/ARCHITECTURE.md](/Users/miko/Documents/simple-dimple/docs/ARCHITECTURE.md:1) и [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md:1) с новым состоянием policy-layer

Зачем:

- decision logic shortlist/assignment больше не должна жить внутри HTTP-роутов
- следующий шаг про persisted `last-known-good route` проще делать поверх отдельного policy-модуля, а не поверх inline-кода в `server.ts`

### State store: убрали seedDefaultData() из каждого метода

Что сделали:

- переместили единственный вызов `seedDefaultData()` в конструктор store, вместо 10 отдельных вызовов на каждый API-метод
- добавили асинхронную инициализацию через `async createPrismaStateStore()`
- сборка TypeScript проходит без ошибок

Зачем:

- убрать ~7 лишних upsert-запросов в БД на каждый эндпоинт
- ранний старт быстрее, каждый запрос легче

### Ranking: удаляем только текущий time bucket, а не всю историю

Что сделали:

- `recomputeAnalyticsForFingerprint()` раньше удалял все ranking-записи для fingerprint, теперь удаляет только записи с `expiresAt === bucketEnd`
- исторические ranking-окна не стираются при каждом новом probe report

Зачем:

- сохранить аналитику по предыдущим временным окнам
- не терять данные для трендов

### Auth-сессии: UUID вместо hardcoded "primary"

Что сделали:

- все новые `AuthSession` создаются с `randomUUID()` вместо `cloneDefaultAuthSession().id` (которое было `"primary"`)
- `readState()` теперь ищет последнюю активную сессию, а не сессию с id `"primary"`
- несколько устройств/входов больше не затирают друг друга

Зачем:

- поддержка множественных сессий
- подготовка к multi-device flow

### Rate limiting: добавили @fastify/rate-limit

Что сделали:

- установили `@fastify/rate-limit` в backend
- зарегистрировали плагин с лимитом 100 запросов в минуту
- защищает все endpoints от перебора паролей и спама

Зачем:

- базовая brute-force защита для login/register
- защита от случайной перегрузки dev-сервера

### writeSession: отделили запись session от полного writeState

Что сделали:

- добавили метод `writeSession(session)` в `StateStore`, который пишет только `AppSession`
- `POST /api/connect` и `POST /api/server` теперь вызывают `writeSession()` вместо `writeState()`
- убрали перезапись user/subscription/device/auth при каждом connect/disconnect

Зачем:

- меньше SQL-запросов на каждый connect/disconnect
- разделение ответственности: session пишется отдельно от account и auth

### State store: modular decomposition

Что сделали:

- разбили монолитный `state-store.ts` (~2400 строк) на 6 модулей в `backend/src/store/`
- `utils.ts` — чистые функции без Prisma (хеши, scoring, fingerprint, маппинг)
- `shared.ts` — Prisma-зависимые хелперы (загрузка юзера, fingerprint resolution)
- `auth.ts` — login, register, challenge/verify, logout
- `session.ts` — readState, writeState, writeSession, listServers, assignEndpoint, lastKnownGoodRoute
- `telemetry.ts` — submitProbeReport, submitFeedback, getHealthSnapshots, getRankings
- `admin.ts` — listAdminUsers, updateAdmin, getOpsSummary
- `state-store.ts` (82 строки) стал фасадом — только импортит и композирует модули
- поправили сигнатуры методов под Prisma 7 (adapter-pg, новый PrismaClient API)
- обновили `ARCHITECTURE.md` — добавили секцию про decomposition

Зачем:

- каждый домен можно читать и менять без пролистывания 2000+ строк соседних
- utils теперь тестируется без Prisma
- добавление нового домена = файл в `store/` + строка в фасад

## Правило обновления

Каждый заметный шаг разработки нужно добавлять сюда кратко и без лишней воды.

Особенно важно фиксировать:

- новые фичи
- архитектурные сдвиги
- изменения dev-сетапа
- подключение новых сервисов
- переходы между этапами roadmap
