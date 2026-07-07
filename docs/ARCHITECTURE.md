# Architecture

Этот документ описывает техническую архитектуру проекта с учетом новой продуктовой цели:

> Пользователь должен видеть очень простой VPN с одной или двумя кнопками.

То есть архитектура может быть достаточно серьезной внутри, но UI обязан оставаться очень простым снаружи.

## 1. Product-facing architecture

Снаружи проект должен выглядеть как:

- `PWA app`
- `mobile-first`
- один главный экран
- одна главная кнопка `Подключить`
- один дополнительный раздел по необходимости

Возможная схема экранов:

- `Home`
- `Server`
- `Account`

Текущий пользовательский контур уже закрепляет разделение:

- `Home` держит только статус и главное действие `Подключить`
- `Server` уводит выбор сервера с главной поверхности
- `Account` живет как отдельный служебный экран, а не повод перегружать первый экран

Admin и технические функции не должны смешиваться с этим слоем.

## 2. Backend

Стек backend:

- `Node.js`
- `Fastify`
- `Prisma`
- `PostgreSQL`

Backend отвечает за:

- auth
- users
- subscriptions
- vpn keys
- server assignment
- health checks
- Xray config generation

Черновая схема данных под это хранится отдельно в [DB_SCHEMA.md](/Users/miko/Documents/simple-dimple/docs/DB_SCHEMA.md).

На текущем dev-этапе backend уже отдает отдельный `account summary` endpoint и принимает обновление профиля, чтобы экран `Account` жил от API, а не от фронтенд-заглушки.
Поверх этого теперь уже есть и минимальный auth-layer:

- DB-backed `AuthSession`
- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/challenge`
- `POST /api/auth/verify`
- `GET /api/admin/users`
- `PATCH /api/admin/users/:userId`

**Важно:** на текущем этапе вход работает **только через login/password**. Email verification и Telegram auth реализованы как challenge-based foundation, но пока не подключены как самостоятельные методы входа. Код в `server.ts` (регистрация) использует функцию `trimmedContactLooksLikeEmail()` для определения `contactType` — если login похож на email, контакт помечается как `email`, иначе как `telegram`. Это позволяет подготовить схему данных заранее, не требуя полноценной верификации на этапе dev.

Планируется:
1. Добавить email verification flow после регистрации
2. Добавить Telegram auth через bot token challenge
3. Сделать multi-provider login (логин/пароль + email verify + Telegram)
4. После этого убрать heuristic `contactType` и заменить на явный выбор при регистрации

Поверх auth-layer уже выделен и простой admin-access слой:

- у `User` есть явный флаг `isAdmin`
- `Ops` и `Admin` экраны не видны обычному пользователю
- backend отдельно проверяет admin-доступ перед route observation и admin-management endpoint-ами
- снятие admin-флага с последнего администратора запрещено, чтобы не потерять доступ к служебному контуру

Для `email verification` и `Telegram auth` на dev-этапе уже выделен отдельный challenge-based слой:

- `VerificationChallenge` хранится в `PostgreSQL`
- backend выдает одноразовый код и подтверждает его отдельным шагом
- локальный стенд пока показывает код прямо в UI, а не доставляет его через внешние сервисы

Даже до появления БД мы уже явно выделяем сущности:

- `user`
- `subscription`
- `devices`

DB-слой уже добавлен в кодовую базу:

- `Prisma` schema
- `prisma.config.ts`
- initial SQL migration
- `Prisma + PostgreSQL` store для `session` и `account`
- `docker compose`-контур для локального `PostgreSQL`

Поверх базового account-слоя уже поднят и первый server-domain foundation:

- `ServerPool` для независимых failure domains
- `Endpoint` для конкретных IP/маршрутов
- текущий `Server`-экран получает каталог уже из БД, а не из frontend/static-константы

Текущий runtime работает только через `PostgreSQL`:

- backend требует `DATABASE_URL`
- локальный стенд поднимает БД через `compose.yaml`
- локальный dev-start ждет готовности БД через `db:wait`
- `session` и `account` больше не имеют file-backed fallback

### Storage-слой: оптимизация и hardening

После внедрения DB-backed store стало заметно несколько проблем, которые были исправлены целенаправленным рефакторингом:

**seedDefaultData() — однократный вызов**
Ранее `seedDefaultData()` вызывался в начале почти каждого метода чтения/записи store, что давало 7 лишних DB-запросов (`upsert` демо user, subscription, device, auth-session, password-credential и двух endpoints) на каждый API-вызов. Исправление: вызов перенесён в конструктор store — один раз после создания, гарантированно до первого запроса. Это не меняет поведение для dev-стенда, но радикально снижает DB-нагрузку.

**Ranking: точечное обновление bucket вместо полной очистки**
`recomputeAnalyticsForFingerprint()` удалял все `RouteRanking` записи для fingerprint перед пересчётом, что уничтожало исторические данные для трендов. Исправлено: `deleteMany` теперь фильтрует по `expiresAt: bucketEnd` — удаляется только текущий time window. Исторические свечи (прошлые часы/дни) сохраняются для аналитики и трендов.

**Auth-сессии: UUID вместо `"primary"`**
Все auth-сессии создавались с фиксированным `id = "primary"`, что исключало multi-device сценарии. Исправлено: при `activateCredentialsSession`, `activateSessionForProvider` и `logout` создаётся `randomUUID()`. `readState()` для поиска текущей сессии использует `findFirst` с сортировкой по `lastAuthenticatedAt desc` вместо `findUnique` по жёсткому id. Это закладывает поддержку нескольких одновременно активных сессий.

**writeSession — изолированное обновление AppSession**
Метод `writeState()` перезаписывал всю вложенную структуру: user, subscription, device, authSession и т.д. — хотя connect/disconnect и выбор сервера меняют только `AppSession`. Добавлен отдельный `writeSession(session)`, который делает один `upsert` на `AppSession`. Endpoints `/api/connect` и `/api/server` переведены на него. Это снижает DB-нагрузку и уменьшает риск конфликтов.

**Rate limiting**
На сервер добавлен глобальный rate limiter (`@fastify/rate-limit`, 100 запросов в минуту). Регистрация — после CORS-плагина, до route-деклараций. Это даёт baseline-защиту от brute-force, хотя для login/register в будущем потребуется точечное ужесточение.

### Storage layer: modular decomposition

После роста store-слоя до ~2400 строк (все auth, session, telemetry, admin — в одном `state-store.ts`) монолит был разбит на модули:

```
backend/src/store/
├── utils.ts          (652 строки) — хеши паролей (scrypt), penalty scoring,
│                       ranking score, network fingerprint, мапперы строк БД,
│                       нормалайзеры, общие ошибки, дефолты
├── shared.ts         (301 строка) — Prisma-зависимые хелперы: загрузка юзера,
│                       fingerprint resolution, рекомпьютинг аналитики
├── auth.ts           (382 строки) — login, register, challenge/verify, logout,
│                       активация сессии
├── session.ts        (545 строк) — readState, writeState, writeSession,
│                       listServers, assignEndpoint, lastKnownGoodRoute
├── telemetry.ts      (211 строк) — submitProbeReport, recordRouteFeedback,
│                       recordRouteWorkflowSnapshot, getHealthSnapshots, getRankings
└── admin.ts          (203 строки) — listAdminUsers, updateAdmin, getOpsSummary
```

`state-store.ts` (82 строки) остаётся фасадом — только импортит модули и композирует их в единый `StateStore`.

Принципы деления:

- **utils.ts** — чистые функции без Prisma-зависимостей (хеши, маппинг, подсчёт рейтингов). Может тестироваться без БД.
- **shared.ts** — Prisma-зависимые хелперы, общие для нескольких модулей (загрузка юзера, fingerprint resolution). Не содержит бизнес-логики высокого уровня.
- **auth.ts / session.ts / telemetry.ts / admin.ts** — ровно один домен на модуль. Каждый экспортирует фабрику `createXxxStore(prisma)`.
- Фасад `state-store.ts` не содержит бизнес-логики — только wiring.

Это даёт:
- Каждый модуль можно читать и менять изолированно, не пролистывая 2000+ строк соседних доменов
- utils можно тестировать без Prisma
- Добавление нового домена (billing, support) — добавить файл в `store/` и одну строку в фасад
- Миграции и ревью стали предсказуемыми по размеру

**Сопутствующие изменения в server.ts:**

При разбиении сигнатуры методов были унифицированы под единый стиль (объекты-аргументы). Соответственно адаптированы вызовы в `server.ts`:

| Старое имя (монолит) | Новое имя (фасад) | Сигнатура |
|---|---|---|
| `recordProbeReport(results, context)` | `submitProbeReport(auth, { results, context })` | объект с `results[]` + `context`, плюс `auth` |
| `recordRouteFeedback(feedback)` | `recordRouteFeedback(auth, feedback)` | единый feedback-объект с `endpointId`, `result`, `source`, context и служебной metadata |
| `getRouteDecisionOpsSummary(includeProbeStats, timeWindowMinutes)` | `getOpsSummary({ includeProbeStats, timeWindowMinutes })` | единый объект-аргумент |
| `updateUserAdmin(userId, isAdmin)` | `updateAdmin({ userId, isAdmin })` | единый объект-аргумент |
| `getRouteHealthSnapshots()` | `getHealthSnapshots(auth, routeContext)` | требует `auth` + `routeContext` |

HTTP-роуты и их контракты не изменились — изменения затронули только внутренние вызовы store.

## 3. VPN layer

Основа VPN не должна зависеть от одного протокола или одного transport-профиля.

Базовая схема:

- primary: `VLESS + REALITY + TCP`
- fallback: `Trojan + TLS + TCP`
- emergency fallback: `Shadowsocks 2022 + TCP`
- optional pool: отдельные `UDP/QUIC`-маршруты, но не как единственная ставка

Поддерживаемые данные на пользователя:

- `UUID`
- `shortID`
- `SNI`
- `fingerprint`

На уровне клиента это не должны быть "три кнопки".

Снаружи пользователь по-прежнему видит одну кнопку `Подключить`, а внутри работает policy engine:

1. проверяет основной маршрут
2. при timeout или handshake failure пробует fallback
3. при деградации TLS-пути пробует emergency-path
4. выбирает самый живой маршрут
5. сохраняет удачный выбор локально
6. периодически тихо перепроверяет альтернативы

После смены сети или обрыва клиент должен идти по такому порядку:

1. последний рабочий маршрут
2. другой transport на том же `IP`
3. другой `IP` того же пула
4. другой провайдер или `ASN` с другим transport
5. сохранить победителя и отправить результат в telemetry

Проверка другого transport на том же `IP` нужна не как полноценный резерв от `IP`-блока, а как диагностика причины деградации:

- все схемы на одном `IP` умерли: вероятен блок `IP`, подсети или `ASN`
- `VLESS` умер, `Trojan` жив: вероятно режется конкретный handshake или сигнатура
- `TCP` жив, `UDP` мертв: вероятно режется `UDP`
- один клиент не проходит, а другие проходят: вероятна проблема оператора, региона или локальной сети клиента

## 4. Anti-DPI layer

Проект рассчитан на anti-censorship сценарий, поэтому backend и VPN слой должны поддерживать:

- rotation `SNI`
- `fingerprint camouflage`
- valid `dest`
- распределение пользователей по узлам
- автоматическое переключение между transport-профилями
- signed fallback-каталог доступных нод внутри клиента
- быстрое исключение деградировавших IP из выдачи

Важно: устойчивость строится не только на протоколе. Если все маршруты живут на одном `VPS` или одном `IP`, блокировка уничтожит сразу весь набор путей.

Также важно: сервер сам не может надежно определить, какой путь реально работает у конечного пользователя. Сервер видит только косвенные признаки вроде открытого порта, попытки handshake и объема трафика. Источник истины для доступности по оператору, региону и типу сети — клиентский probe.

## 5. Multi-server layer

Каждый сервер описывается как node:

- `ip`
- `asn`
- `provider`
- `country`
- `location`
- `capacity`
- `status`
- `health metadata`
- `supported transports`

Backend должен:

- назначать пользователя на сервер
- поддерживать выбор оптимального узла
- уметь выполнять health-check
- генерировать отдельный `Xray config` на сервер

Ноды должны быть распределены по независимым пулам:

- pool `A`: один провайдер / страна / ASN
- pool `B`: другой провайдер / страна / ASN
- pool `C`: третий независимый провайдер

Это важнее, чем поднять три разных протокола на одном IP.

Целевой принцип:

- primary route не должен делить fate с fallback route
- fallback route не должен зависеть от того же ASN
- аварийный маршрут должен переживать блокировку одного дата-центра или подсети

Пример логической модели:

```text
Endpoint
 ├─ provider
 ├─ ASN
 ├─ country
 ├─ server
 ├─ IP-1
 │   ├─ VLESS/REALITY
 │   ├─ Trojan/TLS
 │   └─ Shadowsocks
 ├─ IP-2
 │   ├─ VLESS/REALITY
 │   └─ Trojan/TLS
 └─ IP-3 ...
```

Клиент не должен получать один статичный конфиг. Он должен получать короткий список кандидатов, отсортированный по вероятности успеха для его сети.

## 6. Telemetry and ranking layer

Telemetry не должна быть обязательным условием для самого подключения.

Нормальная схема:

- control или telemetry endpoints живут отдельно от data plane
- используется несколько control endpoints в разных `ASN`
- если отчёт не отправился напрямую, клиент сохраняет его локально и отправляет позже
- при уже поднятом туннеле отчёт можно догрузить через него

Текущий прогресс на dev-этапе:

- `NetworkFingerprint` и `ProbeReport` уже хранятся в `PostgreSQL`
- `ProbeReport` теперь хранит не только общий `result`, но и отдельный `failureReason`
- backend уже принимает `POST /api/telemetry/probe`
- frontend уже шлет best-effort probe report после успешного подключения
- telemetry пока не обязательна для connect-flow и не влияет на основной UX

Минимальный client probe report:

- `network_type`: `mobile` или `wifi`
- `carrier`
- `asn`
- грубая страна и регион
- `endpoint_id`
- `ip_id`
- `transport_profile_id`
- `result`: `dns_fail`, `tcp_fail`, `tls_fail`, `auth_fail`, `connected`, `unstable`
- `latency_ms`
- `bytes_sent`
- `bytes_received`
- `tested_at`
- `app_version`

Ограничения по данным:

- не хранить полный клиентский `IP`
- не хранить историю сайтов или назначения трафика
- для аналитики использовать хешированный сетевой отпечаток и агрегаты

На backend нужен слой агрегации результатов:

```text
network_fingerprint × endpoint_ip × protocol_profile × time_window
→ success_rate
→ median_connect_time
→ disconnect_rate
→ sample_count
```

Текущий прогресс на dev-этапе:

- `RouteSuccessRollup` и `RouteRanking` уже считаются в runtime
- пересчёт сейчас запускается сразу после нового `probe report`
- выдача списка серверов уже может учитывать накопленный ranking для похожего coarse-grained network fingerprint
- `UserEndpointAssignment` уже фиксирует, какой endpoint реально был выдан пользователю при `connect` или ручном выборе
- поверх этого backend уже строит `routePolicy` с shortlist-кандидатами и reason-кодами
- policy-engine уже вынесен в отдельный модуль `backend/src/route-policy.ts`, а не размазан по HTTP-роутам
- `LastKnownGoodRoute` уже хранит успешные маршруты отдельно от assignment, с привязкой к `networkFingerprint` и TTL

Из этого строится персональный или квази-персональный рейтинг кандидатов:

```text
1. VLESS / IP-7 / Provider-B — 93%
2. Trojan / IP-7 / Provider-B — 81%
3. Shadowsocks / IP-22 / Provider-C — 64%

Для БД это значит, что:

- `core`-таблицы живут отдельно от `telemetry`
- raw probe reports живут отдельно от агрегатов `analytics`
- `ops` и audit не смешиваются с клиентской telemetry

На API-слое это теперь выглядит так:

- `GET /api/session` — **основной endpoint для клиента**. Возвращает `session`, `servers`, `currentAssignment`, `routeHealth` и `routePolicy`. Содержит всю информацию, нужную клиенту для старта. Не поддерживает ручной выбор сервера (`manualEndpointId`).
- `POST /api/routes/resolve` — **resolve-контракт без side effects**. Дублирует логику `GET /api/session`, но: (а) поддерживает `manualEndpointId` для ручного выбора сервера; (б) возвращает `lastKnownGoodRoute`, который не нужен основному клиенту; (в) может исключить `servers` из ответа через флаг `includeServers: false`. Сделан отдельным endpoint-ом, чтобы не усложнять `/api/session` опциональными полями и не ломать контракт для основного клиента.
- `POST /api/routes/feedback` теперь замыкает feedback-loop: пишет отдельный `route_event` и одновременно подает сигнал в telemetry/ranking слой
- `POST /api/telemetry/probe` теперь сохраняет не только `result`, но и `testedAt / appVersion / bytes*`, чтобы raw telemetry не теряла полезный контекст
- `POST /api/connect` выбирает верхний кандидат из policy-решения, а не полагается только на текущий `activeServerId`
- `assignmentReason` теперь отражает источник выбора: `manual_override`, `last_known_good`, `network_ranking_primary`, `provider_diversity_fallback` и т.д.
- successful `connect` теперь пишет отдельную `last-known-good` запись, и policy читает ее как более надежный источник, чем текущий assignment
- `routePolicy.trace` теперь также возвращает компактную internal explainability metadata: `selectedBy`, `usedLastKnownGood`, `usedNetworkRanking`, `fallbackTier`
- shortlist selection теперь учитывает failure domain сильнее: transport-diagnostic шаг предпочитает другой `IP`/transport, а diversity fallback старается разнести кандидатов по `provider` и `ASN`
- поверх этого policy теперь читает свежие `probe_reports` для текущего `networkFingerprint` и временно избегает endpoint-ов с серией недавних неуспешных результатов
- ranking поверх тех же данных теперь штрафует маршруты по свежести, типу failure и силе сигнала, а не только по усреднённому fail-rate
- рядом с этим backend теперь строит `routeHealth` snapshots: компактный health-слой для policy с `penaltyScore`, `confidence`, `dominantFailureReason` и `status`
- shortlist selection поверх этого слоя теперь health-aware: для diagnostic/diversity fallback-слотов policy предпочитает менее penalized candidates при прочих равных
- тот же слой теперь уже может demote-ить и исходный primary-кандидат, если penalty/confidence выглядят достаточно сильными по сравнению с соседним healthier endpoint
- появился отдельный persisted workflow layer для фоновых `resolve/re-probe` jobs: `RouteReprobeJob`, admin-only enqueue/list endpoints, lease-aware worker execution и `runtime_reprobe_resolve` snapshot-события
- сам execution worker теперь запускается отдельным процессом через `backend/src/worker.ts`, а API переиспользует общий `runtime.ts`, не держа polling loop внутри `server.ts`
- `GET /api/ops/route-decisions` теперь агрегирует не только route-quality observation, но и `routeReprobeExecution` summary: lifecycle, queue lag, worker activity, timing и recent job drilldown
- CI теперь идет отдельным последовательным контуром: `prisma generate -> migrate -> check -> test -> build`, чтобы не было конкуренции за `backend/src/generated/prisma`
```

Следующий архитектурный слой после этого:

1. связывать job-level execution signals с route-quality observation слоем
2. после этого углублять ops/admin surface до более явных job-level drilldowns
3. затем добавлять alerting/retention вокруг уже появившихся worker health metrics

Для architecture это означает:

- policy-engine должен уметь использовать ограниченный опыт похожих сетей, а не только точного `networkFingerprint`
- telemetry и analytics должны получить явные retention-правила по raw-событиям, rollups и penalty-сигналам
- `routes/resolve` и `routeHealth` уже должны переиспользоваться не только для online connect-flow, но и для фоновых перепроверок
- persisted `route_reprobe_jobs` должен быть источником правды для execution lifecycle, а `route_events` — для explainable observation trail
- execution lifecycle внутри `route_reprobe_jobs` уже должен включать persisted `nextAttemptAt`, `maxAttempts`, stale-lease reclaim, `dead-letter` и attempt audit
- API и worker теперь должны делить один runtime-контракт, а не две расходящиеся реализации resolve/execution logic
- ops/admin слой уже должен уметь показывать рядом и route-quality metrics, и execution health самого background worker-а

## 7. Frontend

Основной frontend:

- `React`
- `Vite`
- `PWA-first`

Frontend не должен быть "кабинетом ради кабинета".

Его задача:

- дать пользователю простой вход
- показать статус
- дать кнопку подключения
- скрыть техническую сложность

Frontend не обязан раскрывать transport-детали обычному пользователю.

На пользовательской поверхности достаточно:

- состояние подключения
- выбранный сервер или регион
- опционально индикатор стабильности

На текущем этапе это выражается так:

- экран `Home` не показывает список серверов
- серверный выбор живет на отдельном экране `Server`
- служебные пользовательские данные живут на отдельном экране `Account`
- навигация остается легкой и не превращает приложение в dashboard
- данные для `Account` уже приходят из backend API и уже связаны с минимальным auth foundation
- базовое редактирование профиля уже идет через backend-контракт, а не через локальный state-only UI
- `Account` уже умеет переживать состояние signed-out и принимать пару `логин/пароль` без подтверждения email

Протокол, transport и fallback-логика должны оставаться внутренней системной частью, а не ежедневным выбором пользователя.

## 8. Mobile strategy

Текущий правильный путь:

1. сделать хороший `PWA-first` интерфейс
2. упростить UX до 1-2 кнопок
3. только потом паковать приложение в `Android/iOS`

То есть `Capacitor` или аналогичный wrapper нужен позже, а не раньше.

## 9. Cleanup rule

Если код не помогает простому PWA-сценарию, его нужно удалять, а не хранить "на всякий случай".

Целевой вектор один:

- один продукт
- один основной клиент
- одна mobile-first логика
