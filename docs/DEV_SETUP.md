# Dev Setup

Этот документ фиксирует текущий рабочий локальный сетап проекта.

Он нужен для двух вещей:

- быстро поднять проект локально
- не смешивать временную dev-реальность с продуктовой и архитектурной стратегией

## Текущий контур

Сейчас проект запускается как два отдельных сервера:

1. `backend`
2. `frontend`

### Backend

Каталог: `/backend`

Стек:

- `Node.js`
- `TypeScript`
- `Fastify`
- `Prisma`
- `PostgreSQL adapter`

Текущая роль:

- тестовый API для проверки пользовательского сценария
- DB-backed storage через `Prisma + PostgreSQL`
- auth foundation через DB-backed `login/password`
- переключение подключения
- переключение тестового сервера
- отдача тестовых account-данных для экрана `Account`
- хранение простых `user / subscription / device` сущностей в `PostgreSQL`
- прием обновления профиля пользователя для `Account`
- admin-only управление флагом `isAdmin` через отдельный API и экран
- стартовая Prisma schema и initial SQL migration под `PostgreSQL`

Текущие endpoint'ы:

- `GET /health`
- `GET /api/session`
- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/account`
- `PATCH /api/account/profile`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`
- `POST /api/connect`
- `POST /api/server`

Порт по умолчанию:

- `8080`

### Frontend

Каталог: `/frontend`

Стек:

- `React`
- `TypeScript`
- `Vite`
- `vite-plugin-pwa`

Текущая роль:

- минимальный `mobile-first` UI
- одна главная кнопка `Подключить`
- показ статуса
- отдельный экран `Server` для выбора тестового сервера
- отдельный экран `Account` для служебных пользовательских данных
- отдельный экран `Ops` для route observation только для администратора
- отдельный экран `Admin` для управления admin-доступом только для администратора
- работа как PWA-оболочка

Порт по умолчанию:

- `5173`

### Связь между серверами

Во время локальной разработки frontend ходит в backend через `Vite proxy`.

Текущая схема:

```text
browser -> localhost:5173 -> proxy -> localhost:8080
```

Проксируются пути:

- `/api`
- `/health`

## Структура проекта

```text
/backend
  /prisma
  package.json
  prisma.config.ts
  tsconfig.json
  /src
    /generated
    server.ts

/frontend
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  /public
  /src
    App.tsx
    main.tsx
    styles.css

/docs
  DEV_SETUP.md

/compose.yaml
```

## Требования

Проверенный локальный runtime:

- `Node.js v24.11.1`
- `npm v11.6.2`

Если версии будут отличаться, проект, скорее всего, все равно запустится, но базово ориентируемся на этот набор.

## Установка

Из корня проекта:

```bash
npm install
```

Скопировать env для backend:

```bash
cp backend/.env.example backend/.env
```

Поднять `PostgreSQL`:

```bash
npm run db:up
```

Применить initial migration:

```bash
npm run db:migrate
```

Проверить готовность БД перед стартом backend:

```bash
npm run db:wait
```

## Запуск

Из корня проекта:

```bash
npm run dev
```

Эта команда поднимает три процесса параллельно:

- сначала ждет готовности `PostgreSQL`
- backend API
- backend worker
- frontend

После запуска доступны:

- app: `http://localhost:5173`
- api: `http://localhost:8080`

## Полезные команды

Запустить только backend:

```bash
npm run dev:backend
```

Запустить только worker:

```bash
npm run dev:worker
```

Запустить только frontend:

```bash
npm run dev:frontend
```

Проверить TypeScript:

```bash
npm run check
```

Проверить production build:

```bash
npm run build
```

Для CI есть отдельные команды без повторного `prisma generate` внутри одного прогона:

```bash
npm run ci:check
npm run ci:build
```

Проверить Prisma schema:

```bash
npm run prisma:validate --workspace backend
```

Сгенерировать Prisma client:

```bash
npm run prisma:generate --workspace backend
```

## CI

В репозитории добавлен workflow [`.github/workflows/ci.yml`](/Users/miko/Documents/simple-dimple/.github/workflows/ci.yml:1).

Он делает шаги последовательно в одном job:

1. `npm ci`
2. `npm run prisma:generate --workspace backend`
3. `npm run prisma:migrate --workspace backend`
4. `npm run ci:check`
5. `npm run test --workspace backend`
6. `npm run ci:build`

Такой порядок нужен, чтобы `backend/src/generated/prisma` не пересоздавался конкурентно несколькими командами в одном и том же workspace.

Поднять только БД:

```bash
npm run db:up
```

Остановить БД:

```bash
npm run db:down
```

Применить migration:

```bash
npm run db:migrate
```

Дождаться готовности БД:

```bash
npm run db:wait
```

## Что уже проверено

Локально уже подтверждено:

- `npm install`
- `npm run db:up`
- `npm run db:migrate`
- `npm run db:wait`
- `npm run check`
- `npm run build`
- ответ backend на `GET /health`
- ответ backend на `GET /api/session`
- ответ backend на `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/challenge`
- `POST /api/auth/verify`
- `POST /api/telemetry/probe`
- ответ backend на `GET /api/account`
- обновление профиля через `PATCH /api/account/profile`
- admin-only список пользователей через `GET /api/admin/users`
- переключение admin-флага через `PATCH /api/admin/users/:userId`
- переключение состояния через `POST /api/connect`
- DB-backed каталог серверов через `GET /api/session`
- работа frontend proxy до backend

## Ограничения текущего стенда

Это именно стартовый dev-стенд, а не финальная инфраструктура.

Пока здесь нет:

- реальной отправки `email`
- реального Telegram-бота или deep-link auth
- реальных VPN-конфигов
- `Xray`
- `Capacitor`
- Android/iOS shell

Сейчас dev-стенд требует рабочий `PostgreSQL`.

Источник локальной БД по умолчанию:

- `docker compose` через [compose.yaml](/Users/miko/Documents/simple-dimple/compose.yaml)
- `DATABASE_URL` из [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1)

## Следующие шаги

Ближайший технический вектор:

1. добавить `email verification` и `Telegram auth` поверх текущего `login/password`
2. подготовить основу под `Capacitor`
3. расширить backend-схему в сторону `server_pools`, telemetry и analytics

Что уже закрыто по пункту 1:

- challenge-based auth foundation для `email` и `Telegram` уже добавлена
- на dev-стенде verification-код показывается прямо в UI
- следующая часть этого шага теперь про реальные внешние доставки, а не про внутренний auth-контракт

Что уже закрыто по backend-схеме:

- `server_pools` и `endpoints` уже добавлены в `Prisma/PostgreSQL`
- текущий список серверов теперь читается из БД
- `telemetry.network_fingerprints` и `telemetry.probe_reports` уже тоже добавлены
- frontend уже шлет best-effort probe report без влияния на UX
- `analytics.route_success_rollups` и `analytics.route_rankings` уже тоже добавлены
- backend уже пересчитывает ranking после новых probe reports
- `GET /api/session` уже может переупорядочивать серверы по накопленному ranking
- `user_endpoint_assignments` уже тоже добавлены
- backend уже записывает assignment при `connect` и ручном выборе сервера
- поверх этого уже добавлен явный shortlist/policy-engine flow
- policy logic уже вынесена в отдельный модуль `backend/src/route-policy.ts`
- `last_known_good_routes` уже тоже добавлены
- backend теперь пишет `last-known-good route` после успешного `connect` и читает его с учетом `network fingerprint`
- compact `decision trace` уже тоже добавлен в `routePolicy`
- более строгие diversity-правила по failure domain уже тоже добавлены
- `routePolicy.trace` теперь возвращает `diversityStageReached`, `shortlistDistinctProviders` и `shortlistDistinctAsns`
- feedback-loop для деградировавших маршрутов уже тоже добавлен
- backend теперь временно избегает endpoint-ов с серией свежих fail/unstable probe results для текущей сети
- probe telemetry теперь уже поддерживает `failureReason`, а ranking штрафует маршруты по свежести и тяжести failures
- `GET /api/session`, `POST /api/connect` и `POST /api/server` теперь уже возвращают `routeHealth` snapshots рядом с `routePolicy`
- fallback-слоты shortlist теперь уже выбираются по health-aware приоритету поверх explainable `routeHealth`
- primary-кандидат теперь тоже может health-adjusted demote-иться при достаточно сильном telemetry signal
- `POST /api/routes/resolve` теперь уже добавлен и переиспользует тот же backend resolve-path, что и session/connect flow
- `POST /api/routes/feedback` теперь уже добавлен и пишет как `route_events`, так и telemetry-сигнал для ranking
- `POST /api/telemetry/probe` теперь уже сохраняет и `testedAt / appVersion / bytes*`, а не только минимальный `result`
- появился persisted admin-only слой фоновых `resolve/re-probe` jobs через `GET/POST /api/ops/route-reprobe-jobs`
- `GET /api/ops/route-decisions` теперь реально возвращает route-quality ops summary, а не общий admin summary
- отдельное наблюдение за качеством route decisions теперь уже включает explainable metrics `fallback pressure`, `degradation windows` и `recovery time`
- admin-доступ теперь уже управляется из UI через отдельный `Admin` экран, а не через ручную правку БД
- в GitHub Actions теперь уже есть отдельный последовательный CI pipeline: `prisma generate -> migrate -> check -> test -> build`
- `cross-network learning` и retention для telemetry уже начали жить в runtime
- persisted worker execution теперь уже умеет `retry/backoff`, stale lease reclaim и `dead-letter` lifecycle
- route-reprobe execution теперь уже реально вынесен в отдельный `backend/src/worker.ts`, а `npm run dev` поднимает API, worker и frontend раздельно
- `Ops` теперь уже показывает и worker execution dashboard: lifecycle counts, queue lag, stale running jobs, timing и recent reprobe job drilldown

## Что делаем дальше

Ближайшая очередь разработки сейчас такая:

1. плотнее связывать job-level execution signals с route-quality observation
2. после этого усиливать ops-слой до более явных job-level drilldowns
3. затем решать retention и alerting вокруг worker-specific health metrics

Практически это значит:

- сделать более явные retention-границы для `probe_reports`, `route_events` и агрегатов
- начать переиспользовать сигналы похожих сетей без превращения ranking в непрозрачную магию
- worker execution уже должен переживать ошибки через persisted `nextAttemptAt`, `maxAttempts`, reclaim просроченного lease и `dead-letter`
- следующий шаг — связывать worker health/lag/audit метрики с влиянием на route-quality decisions, а не только показывать их отдельно
