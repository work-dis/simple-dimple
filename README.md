# Simple Dimple

Простой `mobile-first` VPN-клиент, который мы сначала собираем как `PWA`, а потом готовим к упаковке в `Android` и `iOS`.

## Текущий этап

Сейчас в репозитории уже поднят стартовый dev-стенд из двух серверов для проверки UX и прикладной логики:

- `frontend` на `React + Vite + PWA`
- `backend` на `Node.js + Fastify`

Это не финальный VPN-стек, а рабочая тестовая база под сценарий:

1. открыть приложение
2. нажать `Подключить`
3. увидеть статус
4. при необходимости открыть отдельный экран `Server`

## Что уже есть

### Backend

Каталог: `/backend`

Сейчас backend умеет:

- отдавать `health` endpoint
- хранить тестовую сессию в storage-слое
- переключать состояние `Подключить / Отключить`
- менять активный тестовый сервер
- отдавать состояние auth-сессии
- выполнять `register/login/logout` по паре `логин/пароль`
- отдавать тестовый `account summary` для экрана `Account`
- хранить простые `user / subscription / device` сущности для `Account`
- принимать обновление профиля пользователя для `Account`
- отдавать admin-список пользователей и менять `isAdmin` без ручной правки БД
- работать только через `Prisma + PostgreSQL`
- держать стартовую Prisma schema и initial SQL migration

Storage-слой разбит на модули (`backend/src/store/`): `utils`, `shared`, `auth`, `session`, `telemetry`, `admin` — каждый отвечает за свой домен. Фасады `state-store.ts` и `runtime.ts` только композируют их для API и отдельного worker-процесса.

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

### Frontend

Каталог: `/frontend`

Сейчас frontend умеет:

- показывать минимальный `Home`-экран
- вызывать backend через dev proxy
- держать выбор сервера на отдельном экране `Server`
- держать служебный экран `Account` отдельно от главного подключения
- держать отдельные служебные экраны `Ops` и `Admin` только для администратора
- загружать account-данные из backend API вместо локальной заглушки
- работать с более реальной структурой `user / subscription / devices`
- сохранять профиль пользователя через backend API
- работать как PWA-оболочка

## Структура проекта

```
simple-dimple/
│
├── compose.yaml              # Docker Compose: PostgreSQL для локальной разработки
├── .github/
│   └── workflows/
│       └── ci.yml            # GitHub Actions: Prisma generate -> migrate -> check -> test -> build
├── package.json              # Root — npm workspaces (backend + frontend)
│
├── backend/                  # Node.js + Fastify + Prisma 7 + PostgreSQL
│   ├── .env                  # Локальные переменные (не коммитить)
│   ├── .env.example          # Шаблон переменных
│   ├── package.json          # Зависимости и скрипты
│   ├── tsconfig.json         # TypeScript конфигурация
│   ├── prisma.config.ts      # Prisma 7 config (adapter-pg)
│   ├── prisma/
│   │   ├── schema.prisma     # Prisma schema — все модели БД
│   │   └── migrations/       # SQL migration файлы
│   ├── scripts/
│   │   └── wait-for-db.mjs   # Ожидание готовности PostgreSQL
│   ├── data/
│   │   └── app-state.json    # Fallback storage (legacy, не используется)
│   └── src/
│       ├── server.ts         # Fastify сервер — роуты, middleware, CORS, rate-limit
│       ├── worker.ts         # Отдельный background worker process для route-reprobe jobs
│       ├── runtime.ts        # Общий backend runtime: store + shared resolve-flow
│       ├── state-store.ts    # Фасад storage-слоя — композиция модулей (82 строки)
│       ├── route-policy.ts   # Policy engine — выбор маршрута, ranking, shortlist
│       ├── route-reprobe.ts  # Worker execution loop и shared reprobe helpers
│       ├── types.ts          # TypeScript типы: Account, Session, Route, Telemetry и т.д.
│       ├── defaults.ts       # Дефолтные значения для seed-данных
│       ├── store/            # Storage-слой, разбит по доменам
│       │   ├── utils.ts      # Чистые функции: scrypt, ranking score, fingerprint,
│       │   │                 #   мапперы строк БД, ошибки (652 строки)
│       │   ├── shared.ts     # Prisma-хелперы: загрузка юзера, fingerprint resolution,
│       │   │                 #   recompute аналитики (301 строка)
│       │   ├── auth.ts       # Auth: register, login, logout, challenge/verify,
│       │   │                 #   активация сессии (382 строки)
│       │   ├── session.ts    # Session: readState, writeState, writeSession,
│       │   │                 #   listServers, assignEndpoint, lastKnownGoodRoute (545 строк)
│       │   ├── telemetry.ts  # Telemetry: probe reports, feedback, health snapshots,
│       │   │                 #   rankings (211 строк)
│       │   ├── admin.ts      # Admin: listUsers, updateAdmin, ops summary (203 строки)
│       │   └── __tests__/
│       │       └── ranking.test.ts  # Тесты ranking-логики
│       └── generated/
│           └── prisma/       # Prisma Client — сгенерированные типы и клиент
│
├── frontend/                 # React + Vite + PWA (mobile-first)
│   ├── package.json          # Зависимости и скрипты
│   ├── tsconfig.json         # TypeScript конфигурация
│   ├── vite.config.ts        # Vite config + dev proxy на backend
│   ├── index.html            # Entry point
│   ├── public/
│   │   ├── icon-192.svg      # PWA иконка
│   │   └── icon-512.svg      # PWA иконка
│   └── src/
│       ├── main.tsx          # React entry point
│       ├── App.tsx           # Корневой компонент — роутинг, навигация
│       ├── styles.css         # Глобальные стили
│       ├── types/            # TypeScript типы (API контракты)
│       │   ├── index.ts      # Баррель
│       │   ├── session.ts    # Типы сессии
│       │   ├── auth.ts       # Типы auth
│       │   ├── account.ts    # Типы аккаунта
│       │   ├── route.ts      # Типы маршрутизации
│       │   ├── ops.ts        # Типы ops-панели
│       │   └── admin.ts      # Типы admin-панели
│       ├── lib/              # Утилиты
│       │   ├── index.ts      # Баррель
│       │   ├── http.ts       # HTTP-клиент (fetch wrapper)
│       │   └── formatters.ts # Форматтеры дат, размера и т.д.
│       └── components/
│           ├── index.ts      # Баррель
│           ├── HomeScreen.tsx     # Главный экран — статус, кнопка Подключить
│           ├── ServerScreen.tsx   # Выбор сервера
│           ├── AccountScreen.tsx  # Профиль, подписка, устройства
│           ├── AuthForms.tsx      # Формы входа/регистрации
│           ├── OpsScreen.tsx      # Ops-панель (только admin)
│           ├── AdminScreen.tsx    # Admin-панель: пользователи, права
│           └── ui/
│               ├── index.ts      # Баррель
│               └── (общие UI-компоненты)
│
├── docs/                     # Документация
    ├── ARCHITECTURE.md       # Техническая архитектура
    ├── CHANGELOG.md          # Changelog
    ├── CODE_REVIEW.md        # Code review findings
    ├── DB_SCHEMA.md          # Схема данных БД
    ├── DECISIONS.md          # Архитектурные решения
    ├── DEV_SETUP.md          # Локальный dev setup
    ├── PRODUCT.md            # Продуктовая идея
    ├── ROADMAP.md            # Roadmap
    └── NETWORK_INTELLIGENCE.md  # Network intelligence
```

## Запуск

1. Установить зависимости:

```bash
npm install
```

2. Поднять БД и применить migrations:

```bash
npm run db:up
npm run db:migrate
```

3. Дождаться готовности БД и поднять API, worker и frontend:

```bash
npm run dev
```

4. Открыть:

- app: `http://localhost:5173`
- api: `http://localhost:8080`

## Проверка

```bash
npm run check
npm run build
```

CI в GitHub Actions прогоняет те же проверки последовательно:

1. `npm ci`
2. `npm run prisma:generate --workspace backend`
3. `npm run prisma:migrate --workspace backend`
4. `npm run ci:check`
5. `npm run test --workspace backend`
6. `npm run ci:build`

## Что делаем дальше

Актуальный приоритетный порядок работ (закрыть OTP-утечку → поднять
реальный VLESS+REALITY транспорт → только потом возвращаться к
alerting-слою) зафиксирован отдельно в
[docs/PRIORITY_PLAN.md](/Users/miko/Documents/simple-dimple/docs/PRIORITY_PLAN.md)
и временно переопределяет порядок ниже.

Следующий логичный шаг:

1. решать, нужен ли поверх текущего focused triage drilldown отдельный alert delivery path
2. затем думать, стоит ли выносить часть ops-наблюдения в ещё более специализированный surface
3. параллельно держать docs и ops-контракт синхронизированными, чтобы roadmap не отставал от реального кода

Если приземлять это на локальный репозиторий без внешних сервисов, то следующий practical increment такой:

1. внешний delivery path поверх уже работающего local delivery log
2. при необходимости явные escalation chains или digest scheduling
3. только потом отдельный specialized ops surface, если текущего `Ops` действительно станет мало

Рабочая очередь:

1. при необходимости поднять manual resend/retry controls поверх уже существующего delivery trail
2. при необходимости уточнить policy для secondary-step escalation, а не только `primary -> secondary`
3. только после этого решать, нужен ли более самостоятельный specialized ops surface

Текущий статус:

- `OpsAlert` storage и admin API уже подняты в backend
- persisted alerts feed уже показан в `Ops` UI с actions `acknowledge / snooze / reopen`
- alert rules уже вынесены в отдельный detector module
- persisted alerts теперь дополнительно refresh-ятся из worker/runtime контура, а не только при чтении `GET /api/ops/alerts`
- `Ops` теперь уже умеет показывать escalation preview по admin contacts для каждого persisted alert-а
- поверх preview-слоя теперь уже поднят и local delivery execution: `POST /api/ops/alerts/:alertId/deliver` materialize-ит persisted delivery log по admin recipients
- backend теперь умеет ходить и во внешний transport-adapter: `email` через `Resend API`, `Telegram` через `Bot API`, но persisted `OpsAlertDelivery` trail по-прежнему остаётся источником истины
- `critical` и `watch` alerts теперь разделены по delivery semantics жёстко: `critical` уходят через direct `deliver`, а `watch` только через общий `digest batch`
- `Admin` теперь уже управляет не только флагом `isAdmin`, но и routing knobs для alerting: `immediate on/off`, `digest on/off`, `primary/secondary tier`
- critical delivery теперь проходит через явный chain `primary -> secondary`: backend сначала шлёт в primary tier и только при сбое/пустом первом шаге доходит до secondary
- `Ops` UI теперь умеет не только смотреть preview, но и запускать delivery execution и читать recent delivery log
- active server inventory теперь уже закреплён как явный invariant, а не как свойство seed-данных: backend fail-closed останавливает route flow, если активные endpoint-ы не дают минимум `3` независимых domains по `provider / ASN / region`
- inventory diagnosis теперь проходит через весь ops/alerting контур: summary, persisted alert tile, alert metadata и escalation/local delivery message используют одни и те же `failedDimensions` и `policyViolationMessage`
- следующим шагом теперь уже остаются manual resend/retry controls и более тонкая escalation policy поверх текущего `primary -> secondary` chain

## Документация

- текущий dev setup: [docs/DEV_SETUP.md](/Users/miko/Documents/simple-dimple/docs/DEV_SETUP.md)
- changelog: [docs/CHANGELOG.md](/Users/miko/Documents/simple-dimple/docs/CHANGELOG.md)
- decisions: [docs/DECISIONS.md](/Users/miko/Documents/simple-dimple/docs/DECISIONS.md)
- продуктовая идея: [docs/PRODUCT.md](/Users/miko/Documents/simple-dimple/docs/PRODUCT.md)
- архитектура: [docs/ARCHITECTURE.md](/Users/miko/Documents/simple-dimple/docs/ARCHITECTURE.md)
- схема БД: [docs/DB_SCHEMA.md](/Users/miko/Documents/simple-dimple/docs/DB_SCHEMA.md)
- roadmap: [docs/ROADMAP.md](/Users/miko/Documents/simple-dimple/docs/ROADMAP.md)
- code review: [docs/CODE_REVIEW.md](/Users/miko/Documents/simple-dimple/docs/CODE_REVIEW.md)
- приоритетный план (OTP-фикс → реальный транспорт → alerting): [docs/PRIORITY_PLAN.md](/Users/miko/Documents/simple-dimple/docs/PRIORITY_PLAN.md)
- network intelligence: [docs/NETWORK_INTELLIGENCE.md](/Users/miko/Documents/simple-dimple/docs/NETWORK_INTELLIGENCE.md)
