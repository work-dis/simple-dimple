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

Важно для работоспособности:

- auth-контекст больше не должен жить как process-global переменная backend-а
- текущий dev-контур уже использует request-scoped `AuthSession` через `x-auth-session-id`
- frontend хранит `auth.id` локально и отправляет его в каждый API-запрос
- это не финальная cookie/session архитектура, но уже убирает самый опасный баг класса "один пользователь логинится за другого из-за общего состояния процесса"
- data-plane (`GET /api/session`, `POST /api/routes/resolve`, `POST /api/connect`, `POST /api/server`, `POST /api/telemetry/probe`, `POST /api/routes/feedback`) закрыт тем же `requireAuthenticatedAuthSession`, что и admin/ops — анониму отдаётся `401`, чтобы не утекал каталог нод и нельзя было отравлять route-ranking (см. [DECISIONS.md, Decision 022](DECISIONS.md))
- `AuthSession` имеет абсолютный TTL (`authSessionTtlMs`), а не живёт вечно; просроченная сессия на чтении сама переходит в `expired`
- **известное ограничение:** `AppSession` (`status`/`activeServerId`/`connectCount`) — всё ещё глобальный singleton `id: "primary"`, общий для всех пользователей. Это уже не утечка per-user данных (реальные `connectionConfig`/assignments/`LastKnownGoodRoute` привязаны к `userId`), а вопрос корректности общего статуса; полноценный per-user session state завязан на реальный транспорт из [PRIORITY_PLAN.md, Шаг 2](PRIORITY_PLAN.md)

Для `email verification` и `Telegram auth` на dev-этапе уже выделен отдельный challenge-based слой:

- `VerificationChallenge` хранится в `PostgreSQL`
- backend выдает одноразовый код и подтверждает его отдельным шагом
- HTTP-ответ на `POST /api/auth/challenge` никогда не содержит plaintext `code` —
  код доставляется через переиспользуемый транспорт-модуль
  `backend/src/transport/message-transport.ts` (Resend для email, Telegram Bot API
  для telegram; тот же модуль использует и ops-alert delivery)
- если ни один транспорт не сконфигурирован, код пишется только в server log
  (`console.info`), а не отдается клиенту — см. [DECISIONS.md, Decision 020](DECISIONS.md)

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

Поверх `Endpoint` есть и реальный transport-слой, а не только метаданные:

- `EndpointTransportConfig` (1:1 с `Endpoint`) хранит REALITY-параметры конкретного
  inbound: порт, `publicKey`, `shortId`, `sni`, `fingerprint`, `flow`; это отдельная
  таблица, а не поля на `Endpoint`, потому что не все endpoint-ы в `defaults.ts`
  используют REALITY (`trojan`/`shadowsocks` в текущем dev-инвентаре — нет)
- `User.vlessUuid` — стабильный per-user VLESS client id, генерируется лениво при
  первой выдаче конфига и переиспользуется дальше
- `backend/src/connection-config.ts` строит настоящий `vless://...` connection URI
  из этих данных; `POST /api/routes/resolve` и `POST /api/connect` отдают его в поле
  `connectionConfig` (или `null`, если endpoint/пользователь не подходят)
- единственный сейчас endpoint с реальным (не RFC5737) transport — `de-fra-1`,
  указывает на локальный dev-Xray inbound из `deploy/xray/dev-config.json`
  (`docker compose --profile xray up`); подробности и explicit non-production
  предупреждение — в [deploy/xray/README.md](../deploy/xray/README.md)
- **важно:** сама `PWA` этот туннель поднять не может — она только показывает
  `connectionConfig`; реальное соединение проверяется reference-клиентом
  (`xray-core` CLI / v2rayN / NekoBox) до появления native-обвязки, см.
  [DECISIONS.md, Decision 021](DECISIONS.md)

Текущий runtime работает только через `PostgreSQL`:

- backend требует `DATABASE_URL`
- локальный стенд поднимает БД через `compose.yaml`
- локальный dev-start ждет готовности БД через `db:wait`
- `session` и `account` больше не имеют file-backed fallback

### Storage-слой: оптимизация и hardening

После внедрения DB-backed store стало заметно несколько проблем, которые были исправлены целенаправленным рефакторингом:

После исправления этих проблем появилась ещё одна явная необходимость:

**state mutation serialization — for race safety**
В `backend/src/server.ts` добавлен promise-chain mutex `withStateLock()` для сериализации конкурентных мутаций module-level `state` объекта. Два одновременных `POST /api/connect` или `POST /api/server` не могут теперь прочитать stale `status` и записать расходящееся состояние. Обёрнуты все роуты, мутирующие `state` (`/api/connect`, `/api/server`, `PATCH /api/account/profile`).

**writeState на старте сессии — исключён**
Ранее при старте сессии `readState()` в некоторых путях вызывал `writeState()`, что создавало лишнюю запись в БД ещё до того, как пользователь что-то сделал. Этот вызов был исключён из startup-пути: `readState()` теперь только читает, `writeState()` вызывается только при осмысленных изменениях (connect, выбор сервера, обновление профиля).

**seedDefaultData() — удалён после перехода на Prisma-миграции**
Ранее `seedDefaultData()` вызывался в начале почти каждого метода чтения/записи store, что давало 7 лишних DB-запросов. При рефакторинге store seed был временно вынесен в конструктор, но позже удалён полностью — демо-данные живут только в Prisma-миграциях. На dev-стенде это не влияет на поведение, так как миграция `20260706170000_init` создаёт начальные строки.

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

При разбиении модулей также был замечен дублирующийся `dynamic import` в `admin.ts`: функция `mapUserRowToAdminUserSummary` импортировалась дважды — статически (строка 21) и динамически (`await import("./utils.js")`). Динамический импорт удалён, функция используется из статического импорта.

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
- shortlist selection теперь учитывает failure domain сильнее: transport-diagnostic шаг по возможности уходит в другой regional domain, а diversity fallback старается разнести кандидатов по `provider` и `ASN`
- ops/admin слой теперь также считает inventory health по активным endpoint-ам и server pools, чтобы риск слабого failure-domain inventory был виден ещё до реальной деградации
- поверх этого active inventory теперь уже закреплён как fail-closed invariant на store/runtime-слое: если активные endpoint-ы не дают хотя бы `3` независимых failure domains по `provider / ASN / region`, backend не должен продолжать `resolve/session/connect/server` flow
- inventory health теперь является не только aggregate signal, но и explainable contract: `failedDimensions` и `policyViolationMessage` должны быть доступны одинаково для summary, persisted alerts и escalation/delivery paths
- поверх этого policy теперь читает свежие `probe_reports` для текущего `networkFingerprint` и временно избегает endpoint-ов с серией недавних неуспешных результатов
- ranking поверх тех же данных теперь штрафует маршруты по свежести, типу failure и силе сигнала, а не только по усреднённому fail-rate
- рядом с этим backend теперь строит `routeHealth` snapshots: компактный health-слой для policy с `penaltyScore`, `confidence`, `dominantFailureReason` и `status`
- shortlist selection поверх этого слоя теперь health-aware: для diagnostic/diversity fallback-слотов policy предпочитает менее penalized candidates при прочих равных
- тот же слой теперь уже может demote-ить и исходный primary-кандидат, если penalty/confidence выглядят достаточно сильными по сравнению с соседним healthier endpoint
- появился отдельный persisted workflow layer для фоновых `resolve/re-probe` jobs: `RouteReprobeJob`, admin-only enqueue/list endpoints, lease-aware worker execution и `runtime_reprobe_resolve` snapshot-события
- сам execution worker теперь запускается отдельным процессом через `backend/src/worker.ts`, а API переиспользует общий `runtime.ts`, не держа polling loop внутри `server.ts`
- **graceful shutdown** в `worker.ts`: при `SIGINT/SIGTERM` worker останавливается через `worker.stop()` + `await runtime.disconnect()`. `process.exit()` не используется — процесс завершается естественно после отсоединения от БД.
- `GET /api/ops/route-decisions` теперь агрегирует не только route-quality observation, но и `routeReprobeExecution` summary: lifecycle, queue lag, worker activity, timing и recent job drilldown
- тот же ops summary теперь уже добавляет `execution impact`: слой, который показывает, сколько quality-сигналов накопилось после последнего успешного reprobe completion и есть ли backlog/dead-letter jobs на деградировавших сетях
- recent persisted jobs в том же summary теперь уже несут job-level drilldown: network quality impact после старта job, active degradation flag и candidate health context для quick triage
- поверх этого summary теперь уже добавляет compact operational layer: active alerts, overall severity и retention windows для `probe_reports`, `route_events`, `route_reprobe_jobs`, rollups и rankings
- тот же operational layer теперь уже включает compact hourly history, чтобы ops видел не только "что болит сейчас", но и как менялся feedback/execution mix в последних окнах
- execution summary для persisted jobs теперь также отдает flattened `worker timeline` и grouped `failure drilldown` поверх `attemptAudit`, чтобы lifecycle и recurring failures были читаемы без ручной сборки из raw job JSON
- поверх этих агрегатов execution summary теперь также выбирает `focusedDrilldowns.worker/network/job`: короткий triage-first слой над hotspots, failures и recent jobs
- CI теперь идет отдельным последовательным контуром: `prisma generate -> migrate -> check -> test -> build`, чтобы не было конкуренции за `backend/src/generated/prisma`
```

Следующий архитектурный слой после этого:

1. решать, нужен ли поверх текущего focused drilldown отдельный alert delivery path
2. затем думать, стоит ли уводить часть ops/admin observation в ещё более специализированный surface
3. сохранять focused drilldown explainable и построенным поверх уже существующего observation trail, а не через новую разрозненную логику

Для architecture это означает:

- policy-engine должен уметь использовать ограниченный опыт похожих сетей, а не только точного `networkFingerprint`
- telemetry и analytics должны получить явные retention-правила по raw-событиям, rollups и penalty-сигналам
- `routes/resolve` и `routeHealth` уже должны переиспользоваться не только для online connect-flow, но и для фоновых перепроверок
- persisted `route_reprobe_jobs` должен быть источником правды для execution lifecycle, а `route_events` — для explainable observation trail
- execution lifecycle внутри `route_reprobe_jobs` уже должен включать persisted `nextAttemptAt`, `maxAttempts`, stale-lease reclaim, `dead-letter` и attempt audit
- API и worker теперь должны делить один runtime-контракт, а не две расходящиеся реализации resolve/execution logic
- ops/admin слой уже должен уметь показывать рядом и route-quality metrics, и execution health самого background worker-а
- retention policy и alert thresholds для текущего ops trail уже зафиксированы; history/drilldown слой тоже поднят, поэтому следующий полезный вопрос уже не "каких карточек не хватает", а "нужен ли отдельный delivery/specialized surface поверх текущего explainable summary"

Для локального репозитория это лучше приземлить в такой архитектурный инкремент:

- ввести persisted сущность уровня `ops alert`, собранную из уже существующих `route_events`, `route_reprobe_jobs` и execution/quality thresholds
- отделить `alert detection` от `alert presentation`: summary продолжает быть read-model, а alerts получают собственный lifecycle (`active`, `acknowledged`, `resolved`, опционально `snoozed`)
- первый delivery path должен быть внутренним: API + UI внутри текущего `Ops`, без обязательной внешней доставки
- только после этого появится честная база для решения, нужен ли второй delivery layer через `Telegram/email/push`

Предлагаемая реализация по слоям:

1. **Prisma / storage**
   новая таблица `OpsAlert` с dedupe-ключом и lifecycle-полями; raw execution/quality trail остается источником фактов, а `OpsAlert` становится persisted projection для triage
2. **Detection layer**
   отдельный модуль вида `ops-alerts` или `ops-alert-detector`, который принимает текущий ops snapshot / набор threshold inputs и решает, какой alert открыть, переоткрыть, обновить или закрыть
3. **Store layer**
   store отвечает за идемпотентный upsert alerts, transitions `acknowledge/snooze/resolve` и выборку feed-а
4. **HTTP layer**
   admin-only API не пересчитывает lifecycle на лету, а читает persisted alerts плюс вызывает explicit transitions
5. **UI layer**
   `Ops` показывает alerts как самостоятельный список triage-объектов, а summary/focused drilldown остаются explainable контекстом вокруг них

Минимальный первый scope:

- только internal delivery path
- только ручные transitions из UI
- только alerts, которые уже явно следуют из текущих thresholds: overdue queue, dead-letter jobs, stale running, SLA breaches, quality backlog

Текущий статус:

- storage baseline уже реализован через persisted `OpsAlert`
- первый internal delivery path на backend уже поднят как admin API поверх materialized summary-alerts
- frontend feed и lifecycle actions внутри текущего `Ops` уже реализованы
- alert rules уже вынесены в отдельный detector module
- persisted alert refresh уже дополнительно вынесен в worker/runtime contour, а не остаётся только частью summary-read path
- поверх этого уже появился escalation preview layer: backend умеет посчитать recipients/channels для alert-а по admin contacts без прямой внешней отправки
- local delivery execution теперь тоже поднят: backend materialize-ит persisted `OpsAlertDelivery` log по admin recipients, а frontend умеет запускать delivery и читать последние entries
- admin routing controls теперь тоже являются частью user-model: у admin можно отдельно включать `immediate` и `digest` delivery, а также выбирать `primary/secondary` escalation tier
- критический alert теперь проходит через явный chain `primary -> secondary`: backend не дублирует отправку всем сразу, а идёт ко второму tier только если первый шаг дал сбой или там нет активных recipients
- failed delivery entries теперь тоже являются частью ops lifecycle, а не тупиком: `immediate` retry переиспользует исходный delivery payload, а `digest` retry восстанавливает весь recipient-specific batch и повторяет его одним transport call
- delivered delivery entries теперь тоже не являются тупиком: operator может вручную сделать resend успешной записи, и backend сохранит это как отдельный replay trail, а не замаскирует под failure-driven retry
- обычный automatic delivery path теперь тоже имеет минимальную anti-spam policy: recent successful deliveries удерживают того же recipient-а внутри cooldown window, а operator-driven `retry/resend` остаются явным override
- `watch` digest path поверх этого уже имеет и batch-level cadence: recipient может выйти из cooldown по конкретному alert-у, но всё равно не получить новый digest слишком рано, если совсем недавно уже был другой successful watch batch
- `watch` digest path теперь ещё и подчиняется delivery window: primary tier не отправляется вне разрешённых UTC-часов, но secondary after-hours fallback может всё ещё принять batch, если нужен ночной follow-up
- для `inventory-failure-domain-risk` persisted alert и escalation-preview/delivery message теперь обязаны нести тот же policy diagnosis, что и `inventoryHealth`: counts, failed dimensions и готовый violation message без повторного пересчёта в UI

Что оставляем следующим этапам:

- более сложные escalation chains поверх текущего `primary -> secondary`
- user- or tier-specific quiet windows и ещё более гибкие escalation rules поверх уже работающего cooldown/cadence/window/replay-layer

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
