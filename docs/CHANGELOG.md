# Changelog

Этот файл нужен для краткой хронологии изменений по проекту.

Формат простой:

- дата
- что было сделано
- зачем это было сделано

## 2026-07-08

### Security hardening auth-поверхности: авторизация data-plane, срок жизни сессий, стойкий OTP, CORS

Что сделали (backend):

- **обязательная авторизация data-plane.** `GET /api/session`,
  `POST /api/routes/resolve`, `POST /api/connect`, `POST /api/server`,
  `POST /api/telemetry/probe`, `POST /api/routes/feedback` теперь отвечают `401`
  анониму ([backend/src/server.ts](../backend/src/server.ts)) — раньше анонимный
  клиент получал полный каталог нод с IP и мог отравлять route-ranking фейковой
  телеметрией
- **срок жизни сессии.** `AuthSession` создаётся с абсолютным TTL
  (`authSessionTtlMs` = 30 дней) вместо `expiresAt: null`
  ([backend/src/store/auth.ts](../backend/src/store/auth.ts)); просроченная сессия
  на чтении становится `expired`/`isAuthenticated=false`
- **OTP из CSPRNG + лимит попыток.** Код верификации — `crypto.randomInt` вместо
  `Math.random()`; новое поле `VerificationChallenge.attempts`
  ([migration 20260708170000_verification_challenge_attempts](../backend/prisma/migrations/20260708170000_verification_challenge_attempts/migration.sql)),
  после 5 неверных вводов challenge гасится
- **CORS.** origin из `CORS_ALLOWED_ORIGINS` (список через запятую), пусто =
  reflect-all только для dev ([backend/.env.example](../backend/.env.example))
- тесты: срок жизни сессии и лимит OTP-попыток в
  [backend/src/store/__tests__/auth.test.ts](../backend/src/store/__tests__/auth.test.ts)

Что сделали (frontend):

- сессия грузится только для аутентифицированного пользователя, `401` трактуется
  как signed-out, а не ошибка; кнопка `Подключить` заблокирована до входа
  ([frontend/src/hooks/useRouteSession.ts](../frontend/src/hooks/useRouteSession.ts),
  [frontend/src/App.tsx](../frontend/src/App.tsx),
  [frontend/src/components/HomeScreen.tsx](../frontend/src/components/HomeScreen.tsx))

Зачем:

- продолжение линии [DECISIONS.md, Decision 020](DECISIONS.md) (OTP-утечка), но со
  стороны доступа и стойкости: закрываем утечку инвентаря нод анониму, отравление
  ranking, вечные неотзываемые сессии и перебор OTP; подробности и осознанно
  отложенное (глобальный `AppSession`, npm audit, dev-значения) —
  [DECISIONS.md, Decision 022](DECISIONS.md)

### Backend сам проверяет живучесть endpoint'ов и убирает сломанные из ротации; фронтенд — по ROADMAP Этапу 1

Что сделали (backend):

- новая таблица полей на `Endpoint`: `lastHealthCheckAt`/`lastHealthCheckOk`/
  `lastHealthCheckLatencyMs`/`consecutiveHealthFailures`
  ([migration 20260708150000_endpoint_health_check](../backend/prisma/migrations/20260708150000_endpoint_health_check/migration.sql))
- [backend/src/endpoint-healthcheck.ts](../backend/src/endpoint-healthcheck.ts) —
  чистая функция `checkTcpReachability`: реальный TCP-коннект к `ipAddress:port`
  endpoint'а с таймаутом, замер latency
- [backend/src/store/endpoint-healthcheck.ts](../backend/src/store/endpoint-healthcheck.ts) —
  `listCheckableEndpoints()` берёт только endpoint'ы с реальным
  `EndpointTransportConfig` (нечего проверять у vitrine-данных без порта);
  `applyHealthCheckResult()`: успех — endpoint помечается активным, latency
  обновляется и на самом endpoint (влияет на baseline-сортировку в
  `listServers()`, не только на отображение); 3 провала подряд — endpoint
  автоматически получает `isActive: false` и выпадает из инвентаря/shortlist
  (route-policy и так уже фильтрует по `isActive`, значит трафик сам
  переключается на другой рабочий endpoint без ручного вмешательства);
  успешная проверка после этого реактивирует endpoint обратно
- [backend/src/endpoint-healthcheck-worker.ts](../backend/src/endpoint-healthcheck-worker.ts) —
  независимый от per-user route-reprobe очереди фоновый воркер (по умолчанию
  каждые 15с), подключён в [backend/src/worker.ts](../backend/src/worker.ts)
  рядом с `route-reprobe-worker`
- тесты: [backend/src/__tests__/endpoint-healthcheck.test.ts](../backend/src/__tests__/endpoint-healthcheck.test.ts),
  [backend/src/store/__tests__/endpoint-healthcheck.test.ts](../backend/src/store/__tests__/endpoint-healthcheck.test.ts),
  [backend/src/__tests__/endpoint-healthcheck-worker.test.ts](../backend/src/__tests__/endpoint-healthcheck-worker.test.ts)

Что сделали (frontend, [ROADMAP.md, Этап 1](ROADMAP.md)):

- [frontend/src/components/HomeScreen.tsx](../frontend/src/components/HomeScreen.tsx) —
  кнопка `Подключить`/`Отключить` стала большим кругом по центру экрана
  (`.connectButton`: `200x200px`, `border-radius: 50%`); блок с регионом/
  временем/policy свернут в одну маленькую приглушённую строку под кнопкой
  вместо четырёх dashboard-карточек; убрали неиспользуемые пропсы
  `servers`/`currentAssignment` из `HomeScreen`
- [frontend/src/styles.css](../frontend/src/styles.css) — `.homeMeta` больше не
  grid из карточек с фоном, а центрированный текст мелким приглушённым шрифтом;
  `.secondaryButton` (`Сервер: …`) стал плоской неброской ссылкой без рамки/фона

Зачем:

- [PRIORITY_PLAN.md, Шаг 2](PRIORITY_PLAN.md) требует, чтобы клиент "сам нашёл
  рабочий маршрут" — раньше единственным источником правды о здоровье
  endpoint'а был client-reported телеметрический отчёт конкретного
  пользователя; теперь backend сам, независимо от пользователей, знает какие
  endpoint'ы реально живы и быстрые, и снимает с ротации то, что сломалось —
  это и есть "автозамена" сломанного конфига на рабочий, без участия человека
- [ROADMAP.md, Этап 1](ROADMAP.md) — главный экран должен быть "статус + одна
  большая кнопка", без dashboard-карточек и технических полей; вся сложность
  (какой маршрут живой/быстрый) теперь целиком на бэкенде, а не в UI

### Этап 2a: connectionConfig дошёл до фронтенда + закрыли пробел в `/api/server` + первая живая проверка

Что сделали:

- `frontend/src/types/session.ts` — добавлен тип `ConnectionConfigSummary`
  (зеркало `backend/src/types.ts`) и поле `connectionConfig?: ConnectionConfigSummary | null`
  в `SessionResponse`
- `frontend/src/hooks/useRouteSession.ts` — новое состояние `connectionConfig`,
  заполняется из ответов `POST /api/connect` и `POST /api/server`, сбрасывается
  в `null`, когда бэкенд возвращает `null` (disconnected/не-vless endpoint);
  наружу отдаётся из хука наравне с `session`/`routePolicy`
- `POST /api/server` ([backend/src/server.ts](../backend/src/server.ts)) раньше
  не выдавал `connectionConfig` вообще (только `/api/connect` и `/api/routes/resolve`
  это делали) — если переключить сервер во время активного подключения,
  фронтенд остался бы с конфигом от старого endpoint. Добавили выдачу
  `connectionConfig` и туда же, когда `state.status === "connected"`
- живая проверка вместо чтения кода: подняли `postgres`+`xray` через
  `docker compose --profile xray up`, накатили миграции, засеяли dev-инвентарь
  из `defaults.ts`, зарегистрировали тестового пользователя, прогнали PWA
  через Vite dev server и реально понажимали `Подключить`/`Отключить`/смену
  сервера в браузере — `connectionConfig` в ответах `/api/connect` и `/api/server`
  корректно появляется/пропадает/обновляется на живом REALITY inbound
  (`uuid`/`publicKey`/`shortId` совпадают с работающим `xray-core`)
- сквозной SOCKS-туннель через REALITY не был до конца проверен в этой среде —
  handshake через `host.docker.internal` в Docker Desktop на macOS нестабилен;
  это похоже на артефакт виртуализованной сети хоста, а не баг кода (конфиг,
  который отдаёт бэкенд, побайтово совпадает с тем, что ждёт сервер). Стоит
  перепроверить на реальном dev-VPS

Зачем:

- [PRIORITY_PLAN.md, Шаг 2, Этап 2b, п.5](../docs/PRIORITY_PLAN.md) требует
  подключить `connectionConfig` к экрану подключения во фронтенде — без
  Android-тулинга дальше состояния/типов дойти нельзя (сам вызов `VpnTunnelPlugin`
  живёт в `mobile/`, который не собирается в этой среде), но подготовить
  данные для будущего вызова можно и нужно уже сейчас
- `/api/server` — реальный пробел в контракте, а не то, что просил план буквально:
  без него переключение сервера во время подключения оставляло бы фронтенд с
  устаревшим/неверным connection-конфигом

### Этап 2a: реальный VLESS+REALITY inbound (dev) + backend выдаёт настоящий connectionConfig

Что сделали:

- добавили локальный dev-Xray в [compose.yaml](/Users/miko/Documents/simple-dimple/compose.yaml:1)
  (`profiles: ["xray"]`) с конфигом [deploy/xray/dev-config.json](/Users/miko/Documents/simple-dimple/deploy/xray/dev-config.json:1) —
  реальный VLESS+REALITY inbound на `127.0.0.1:8443`, явно помечен как non-production
- расширили Prisma-схему: новая таблица `EndpointTransportConfig` (1:1 с `Endpoint`;
  порт/publicKey/shortId/sni/fingerprint/flow — не на самом `Endpoint`, потому что не
  у всех endpoint-ов в `defaults.ts` вообще есть REALITY-транспорт) и `User.vlessUuid`
  для стабильного per-user VLESS client id; миграция
  [20260708130000_endpoint_transport_config](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260708130000_endpoint_transport_config/migration.sql:1)
- `backend/src/defaults.ts`: `de-fra-1` теперь указывает на реальный `127.0.0.1`
  вместо RFC5737-заглушки и получил `defaultEndpointTransportConfigs`, которые один
  в один совпадают со значениями в `dev-config.json`
- новый чистый модуль [backend/src/connection-config.ts](/Users/miko/Documents/simple-dimple/backend/src/connection-config.ts:1)
  строит настоящий `vless://` URI (`pbk`/`sid`/`sni`/`fp`/`flow`), и store-обёртка
  [backend/src/store/connection-config.ts](/Users/miko/Documents/simple-dimple/backend/src/store/connection-config.ts:1)
  (`issueConnectionConfig`) генерирует и переиспользует per-user `vlessUuid`
- `POST /api/routes/resolve` и `POST /api/connect` возвращают новое поле
  `connectionConfig` (не ломая текущий контракт `session`/`routePolicy`); `null` —
  если пользователь не залогинен, endpoint не в REALITY-инвентаре или транспорт ещё
  не сконфигурирован
- тесты: [backend/src/__tests__/connection-config.test.ts](/Users/miko/Documents/simple-dimple/backend/src/__tests__/connection-config.test.ts:1)
  на построение URI и
  [backend/src/store/__tests__/connection-config.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/connection-config.test.ts:1)
  на выдачу/переиспользование uuid и на все null-ветки

Зачем:

- [PRIORITY_PLAN.md, Шаг 2, Этап 2a](/Users/miko/Documents/simple-dimple/docs/PRIORITY_PLAN.md:78) —
  первый случай, когда backend реально выдаёт рабочий connection-конфиг, а не
  только `recommendedReason`/метаданные; проверяется reference-клиентом
  (`xray-core` CLI / v2rayN / NekoBox), а не веб-клиентом — см.
  [DECISIONS.md, Decision 021](/Users/miko/Documents/simple-dimple/docs/DECISIONS.md:1)
  про то, почему PWA физически не может сама держать этот туннель

Что осталось для полного Definition of done Шага 2:

- ручная проверка через reference-клиент выполнена частично в более поздней сессии
  (см. запись выше от того же дня): backend↔xray-inbound конфиг проверен вживую
  (uuid/publicKey/shortId совпадают), но сквозной SOCKS-туннель через REALITY
  не был до конца проверен из-за нестабильного handshake через
  `host.docker.internal` в Docker Desktop на macOS — стоит перепроверить на
  реальном dev-VPS вместо локального докера
- Этап 2b — Capacitor Android shell

### Закрыли OTP-утечку: verification-код больше не уходит в HTTP-ответе

Что сделали:

- `requestAuthChallenge()` в [backend/src/store/auth.ts](/Users/miko/Documents/simple-dimple/backend/src/store/auth.ts:1)
  больше не возвращает наружу plaintext `code` — только `challengeId`/`provider`/`target`/`expiresAt`
- вынесли общую транспорт-логику (Resend email, Telegram Bot API, `local_dev_outbox`
  fallback) из [backend/src/store/ops-alert-delivery.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alert-delivery.ts:1)
  в переиспользуемый модуль [backend/src/transport/message-transport.ts](/Users/miko/Documents/simple-dimple/backend/src/transport/message-transport.ts:1);
  ops-alerts теперь тонкая обертка над ним
- `requestAuthChallenge()` доставляет код через этот же транспорт; если ни email,
  ни telegram транспорт не сконфигурированы, код пишется в server log
  (`console.info`), а не в ответ клиенту; если сконфигурированный транспорт
  реально падает — бросаем ошибку вместо тихого "успеха"
- убрали фронтенд-автозаполнение поля кода и dev-виджет "Dev-код: ..." в
  [frontend/src/hooks/useAuthAccount.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useAuthAccount.ts:1)
  и [frontend/src/components/AuthForms.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/AuthForms.tsx:1)
- добавили regression-тесты в
  [backend/src/store/__tests__/auth.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/auth.test.ts:1),
  которые ловят, если `code`/`codeHash` снова попадут в ответ `requestAuthChallenge()`

Зачем:

- прежний ответ `/api/auth/challenge` отдавал одноразовый код прямо в HTTP-теле —
  email/Telegram верификация ничего не проверяла, это была активно эксплуатируемая
  дыра для account takeover; см. [PRIORITY_PLAN.md, Шаг 1](/Users/miko/Documents/simple-dimple/docs/PRIORITY_PLAN.md:18)
  и [DECISIONS.md, Decision 020](/Users/miko/Documents/simple-dimple/docs/DECISIONS.md:1)

### Quiet window / delivery window with secondary after-hours fallback for watch digests

Что сделали:

- добавили quiet-window policy в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1): `watch` digest теперь удерживает primary tier вне разрешённого UTC-окна, но secondary after-hours fallback всё ещё может принять batch
- добавили env knobs `OPS_ALERT_DIGEST_WINDOW_START_HOUR_UTC` и `OPS_ALERT_DIGEST_WINDOW_END_HOUR_UTC` в [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1)
- backend `digest-deliver` теперь возвращает явный hold `quiet window policy`, только если outside-window batch уже некуда эскалировать; иначе secondary tier забирает after-hours batch
- расширили tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1), чтобы зафиксировать both secondary after-hours fallback и true outside-window hold без secondary tier

Зачем:

- не превращать watch-level follow-up в ночной spam, не теряя при этом возможность after-hours escalation в secondary tier
- отделить `delivery window` от `cooldown` и `cadence`, чтобы policy читалась как три разных слоя, а не как один непрозрачный throttle
- честно сместить следующий шаг уже к более гибким per-user/per-tier windows, а не к отсутствующему global quiet-window baseline

### Digest cadence policy over watch-level batch delivery

Что сделали:

- добавили batch-level digest cadence в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1): `watch` digest теперь смотрит не только на cooldown по тому же alert-у, но и на recent successful digest batches по recipient-у в целом
- если primary digest recipient недавно уже получал другой watch batch, backend может сразу отправить digest в доступный secondary tier; если cadence-window ещё не пережил никто, `digest-deliver` получает явный hold по cadence policy
- добавили env knob `OPS_ALERT_DIGEST_CADENCE_MS` в [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1)
- расширили tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1) и UI error handling в [frontend/src/hooks/useRouteDecisionOps.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useRouteDecisionOps.ts:1)

Зачем:

- сделать watch-level digest менее шумным даже после того, как per-alert cooldown уже пройден
- развести semantics `cooldown for same alert/feed` и `cadence for whole watch batch stream`, чтобы следующая policy уже строилась поверх более честного baseline
- честно сместить следующий шаг уже к quiet windows и delivery windows, а не к отсутствующему digest cadence layer

### Delivery cooldown policy for automatic ops alert escalation

Что сделали:

- добавили cooldown-aware delivery policy в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1): обычные `deliver` и `digest-deliver` теперь смотрят на recent successful `OpsAlertDelivery` entries и временно удерживают того же recipient-а от повторной автоматической отправки
- для `immediate` escalation это также влияет на tier routing: если primary recipient ещё в cooldown, backend может сразу перейти к доступному secondary tier вместо повторного спама в тот же контакт
- добавили env knobs в [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1): `OPS_ALERT_IMMEDIATE_COOLDOWN_MS` и `OPS_ALERT_DIGEST_COOLDOWN_MS`
- расширили tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1) и обновили UI error handling в [frontend/src/hooks/useRouteDecisionOps.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useRouteDecisionOps.ts:1)

Зачем:

- дать ops-alert escalation минимальную anti-spam policy до появления более сложных scheduling/cadence правил
- удержать distinction между automatic throttled delivery и operator-driven `retry/resend`, которые по-прежнему остаются явным ручным bypass
- честно сместить следующий шаг уже к digest cadence, quiet windows и более богатым escalation rules, а не к отсутствующему cooldown-baseline

### Manual resend for already delivered ops alert entries

Что сделали:

- добавили отдельный backend flow `resend` в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1) и admin endpoint `POST /api/ops/alerts/:alertId/deliveries/:deliveryId/resend` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- delivered `immediate` entry теперь можно осознанно переотправить как operator-driven resend, а delivered `digest` entry переигрывает весь recipient-specific batch одним новым transport call без подмены под `retry`
- `Ops` UI в [frontend/src/components/OpsScreen.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/OpsScreen.tsx:1), [frontend/src/hooks/useRouteDecisionOps.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useRouteDecisionOps.ts:1) и [frontend/src/App.tsx](/Users/miko/Documents/simple-dimple/frontend/src/App.tsx:1) теперь показывает `Send again` для успешных delivery entries
- расширили unit-tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1), чтобы зафиксировать both immediate и digest resend semantics

Зачем:

- дать администратору честный manual resend-path без необходимости симулировать transport-failure ради повторной отправки
- сохранить explainable distinction между `retry after failure` и `manual resend after success` прямо в persisted delivery metadata
- честно сместить следующий шаг уже к более тонкой escalation policy, scheduling и throttling, а не к отсутствующим operator actions

### Manual retry controls over persisted ops alert delivery trail

Что сделали:

- добавили backend retry-flow в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1) и admin endpoint `POST /api/ops/alerts/:alertId/deliveries/:deliveryId/retry` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1)
- failed `immediate` deliveries теперь переотправляются как single retry с новым persisted `batchId`, а failed `digest` deliveries восстанавливают весь recipient-specific batch и повторяют его одним transport call без потери explainable trail
- `Ops` UI в [frontend/src/components/OpsScreen.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/OpsScreen.tsx:1) и [frontend/src/hooks/useRouteDecisionOps.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useRouteDecisionOps.ts:1) теперь позволяет запускать `Retry failed` прямо из delivery log
- расширили tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1), чтобы зафиксировать both immediate и digest retry semantics

Зачем:

- закрыть следующий roadmap-шаг про manual retry controls, не заставляя администратора пересобирать delivery object вручную
- сохранить один explainable delivery lifecycle и для первой попытки, и для ручного retry, включая linkage между old/new batches
- честно сместить следующую очередь уже к более тонкой escalation policy и scheduling, а не к отсутствующему retry-baseline

### Admin routing controls and primary-secondary escalation chain

Что сделали:

- расширили модель `User` новыми routing-полями в [backend/prisma/schema.prisma](/Users/miko/Documents/simple-dimple/backend/prisma/schema.prisma:112) и migration [backend/prisma/migrations/20260708113000_ops_alert_admin_routing_controls/migration.sql](/Users/miko/Documents/simple-dimple/backend/prisma/migrations/20260708113000_ops_alert_admin_routing_controls/migration.sql:1): `opsAlertImmediateEnabled`, `opsAlertDigestEnabled`, `opsAlertEscalationTier`
- backend admin API теперь умеет менять не только `isAdmin`, но и эти routing knobs через [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:990) и [backend/src/store/admin.ts](/Users/miko/Documents/simple-dimple/backend/src/store/admin.ts:1647)
- escalation preview и delivery execution в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1) теперь знают про явный chain `primary -> secondary`: для `critical` alerts второй шаг включается только если первый tier не сработал, а digest использует тот же tiered routing без случайной массовой рассылки
- обновили [frontend/src/components/AdminScreen.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/AdminScreen.tsx:1), [frontend/src/hooks/useAdminUsers.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useAdminUsers.ts:1) и [frontend/src/components/OpsScreen.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/OpsScreen.tsx:1), чтобы routing controls и chain были видны и управляемы из UI
- расширили tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1): теперь они фиксируют direct delivery только в primary tier и secondary fallback при failure

Зачем:

- дать ops-контуру реальные admin controls поверх уже работающего delivery trail, а не держать routing жёстко зашитым в коде
- сделать escalation semantics объяснимыми: не “шлём всем”, а “идём по tiers и эскалируем дальше только когда это действительно нужно”
- честно сместить следующий шаг уже к manual resend/retry controls и более тонкой escalation policy, а не к отсутствующим базовым knobs

### Watch alerts moved into persisted digest batch flow

Что сделали:

- разделили delivery semantics в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1): direct `deliver` теперь работает только для `critical` alerts, а `watch`-уровень уходит через отдельный persisted digest batch
- добавили backend endpoint `POST /api/ops/alerts/digest-deliver` в [backend/src/server.ts](/Users/miko/Documents/simple-dimple/backend/src/server.ts:1) и store-method `deliverDigest`, который собирает все активные `watch` alerts в один transport message на recipient, но сохраняет delivery trail по каждому alert-у с общим `batchId`
- обновили [frontend/src/components/OpsScreen.tsx](/Users/miko/Documents/simple-dimple/frontend/src/components/OpsScreen.tsx:1) и [frontend/src/hooks/useRouteDecisionOps.ts](/Users/miko/Documents/simple-dimple/frontend/src/hooks/useRouteDecisionOps.ts:1): `critical` tile отправляет `Send now`, а `watch` tile запускает `Send digest batch`
- расширили unit-tests в [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1), чтобы зафиксировать запрет direct-send для `watch` и semantics единого digest batch по recipients

Зачем:

- закрыть roadmap-пункт про понятное правило `watch` vs `critical`, а не оставлять ручную доставку случайной
- сохранить persisted delivery trail explainable даже для агрегированного digest message, не теряя привязку к конкретным alert-ам
- честно сместить следующий шаг уже к resend/admin knobs и escalation chains, а не к базовой digest-механике

### External Telegram/email delivery adapters over persisted ops alert trail

Что сделали:

- добавили backend transport module [backend/src/store/ops-alert-delivery.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alert-delivery.ts:1) с channel-specific adapters для `email` и `Telegram`
- `Ops` alert delivery теперь умеет не только писать `local_dev_outbox`, но и ходить во внешний `Resend API` для `email` и в `Telegram Bot API` для `telegram`, если заданы env-переменные из [backend/.env.example](/Users/miko/Documents/simple-dimple/backend/.env.example:1)
- persisted `OpsAlertDelivery` trail в [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1) теперь хранит не только preview-данные, но и реальный `deliveryPath`, `providerMessageId`, transport metadata и failed attempts
- расширили unit-test [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1) на success/failure semantics для внешних transport-ов

Зачем:

- закрыть roadmap-шаг не только на уровне local delivery execution, но и на уровне настоящего внешнего transport-adapter
- сохранить один и тот же explainable alert object для preview, persisted trail и реальной отправки, не разъезжаясь по semantics между каналами
- честно сместить следующий шаг уже к `digest`/`escalation chain` политике и admin controls, а не к отсутствующему базовому transport layer

### Inventory policy hardened into fail-closed invariant and explainable alert context

Что сделали:

- вынесли inventory-policy в отдельный backend helper [backend/src/inventory-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/inventory-policy.ts:1) и закрепили minimum invariant: активный inventory обязан держать минимум `3` независимых failure domains по `provider / ASN / region`
- добавили fail-fast проверку в [backend/src/defaults.ts](/Users/miko/Documents/simple-dimple/backend/src/defaults.ts:1) и fail-closed enforcement в [backend/src/store/session.ts](/Users/miko/Documents/simple-dimple/backend/src/store/session.ts:1): если активные endpoint-ы policy не проходят, backend возвращает `503`, а не продолжает `session/resolve/connect/server` flow
- расширили `inventoryHealth` в [backend/src/types.ts](/Users/miko/Documents/simple-dimple/backend/src/types.ts:1) и [frontend/src/types/ops.ts](/Users/miko/Documents/simple-dimple/frontend/src/types/ops.ts:1) новыми explainable-полями `failedDimensions` и `policyViolationMessage`
- `Ops` UI теперь показывает этот diagnosis и в summary, и в persisted alert tile, а detector/materialized alerts используют тот же policy message для `inventory-failure-domain-risk`
- escalation preview и local delivery message для inventory-alert теперь тоже включают breakdown по policy failure: failed dimensions, inventory counts и policy target
- добавили unit-tests в [backend/src/__tests__/inventory-policy.test.ts](/Users/miko/Documents/simple-dimple/backend/src/__tests__/inventory-policy.test.ts:1), [backend/src/store/__tests__/session.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/session.test.ts:1), [backend/src/store/__tests__/route-decision-ops.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/route-decision-ops.test.ts:1) и [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1)

Зачем:

- перестать считать diversity active inventory случайным свойством seed-данных и сделать его явным runtime policy
- fail-closed останавливать route resolution, когда выбирать по-настоящему не из чего, вместо косметического `riskLevel` рядом с продолжающимся connect-flow
- сохранить один и тот же explainable diagnosis для summary, persisted alerts и escalation/delivery, чтобы ops-контур не пересобирал policy failure по-разному в каждом слое

### Failure-domain hardening for transport-diagnostic fallback

Что сделали:

- ужесточили shortlist selection в [backend/src/route-policy.ts](/Users/miko/Documents/simple-dimple/backend/src/route-policy.ts:1): transport-diagnostic fallback теперь по возможности выбирается вне того же `provider/country/region/ASN` regional domain, а не только по другому `transport` или `IP`
- emergency fallback теперь тоже сначала старается брать кандидатов из более независимого failure domain, а уже потом добирать локальные соседние варианты
- добавили отдельный unit-test [backend/src/__tests__/route-policy.test.ts](/Users/miko/Documents/simple-dimple/backend/src/__tests__/route-policy.test.ts:1) на regional-domain fallback behavior и сохранение diversity при health-aware выборе
- синхронизировали `ROADMAP`, `ARCHITECTURE`, `DEV_SETUP` и `NETWORK_INTELLIGENCE` с новым правилом shortlist

Зачем:

- сделать этап `Failure Domains` более реальным: не только разные labels и transports, но и более независимые региональные кластеры
- снизить шанс, что shortlist выглядит разнообразным, оставаясь в одном и том же близком failure domain
- подготовить следующий шаг к более явной inventory/server-pool политике, а не к косметическим изменениям trace-полей

### Inventory risk surfaced in Ops summary

Что сделали:

- расширили [backend/src/store/admin.ts](/Users/miko/Documents/simple-dimple/backend/src/store/admin.ts:1), чтобы `GET /api/ops/route-decisions` считал `inventoryHealth` по активным endpoint-ам и server pools: providers, ASN, pools, regional domains и размер крупнейшего кластера
- расширили detector в [backend/src/store/ops-alert-detector.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alert-detector.ts:1): слабый inventory теперь превращается в explainable alert `inventory-failure-domain-risk`
- `Ops` UI показывает inventory risk прямо в summary-блоке, а unit-test в [backend/src/store/__tests__/route-decision-ops.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/route-decision-ops.test.ts:1) фиксирует этот сценарий
- синхронизировали `ROADMAP`, `ARCHITECTURE` и `DEV_SETUP` с тем, что risk слабого server inventory теперь виден как рабочий ops signal

Зачем:

- сделать этап `Failure Domains` не только про shortlist policy, но и про качество самого inventory
- заранее подсвечивать ситуацию, когда policy уже умеет выбирать независимо, а выбирать по-настоящему не из чего
- сместить следующий шаг к реальному server-pool hardening, а не к догадкам по runtime traces

### Local delivery execution over ops alert escalation preview

Что сделали:

- добавили Prisma-модель `OpsAlertDelivery` и migration `20260708011000_ops_alert_deliveries` для persisted delivery log по alert-ам и recipients
- расширили backend store [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1) операциями `listDeliveries` и `deliver`, которые materialize-ят local delivery execution поверх уже существующего escalation preview
- подняли admin-only endpoints `GET /api/ops/alerts/:alertId/deliveries` и `POST /api/ops/alerts/:alertId/deliver`
- `Ops` UI теперь умеет запускать delivery execution и показывать recent delivery log рядом с persisted alert lifecycle
- добавили unit-test на delivery execution semantics и перепроверили `backend` tests, `frontend` build и `prisma validate`

Зачем:

- закрыть шаг roadmap про реальную delivery execution поверх preview-слоя, не таща преждевременно полноценные внешние SMTP/Telegram интеграции
- сделать alert delivery не только вычисляемым preview, но и persisted explainable execution trail
- честно сместить следующий шаг уже к внешним каналам или escalation chains, а не назад к внутренней delivery-механике

## 2026-07-07

### Ops alerts verification tightened around persisted lifecycle

Что сделали:

- расширили unit-test [backend/src/store/__tests__/ops-alerts.test.ts](/Users/miko/Documents/simple-dimple/backend/src/store/__tests__/ops-alerts.test.ts:1), чтобы он проверял не только `escalation preview`, но и `detect -> materialize -> resolve` lifecycle persisted alerts
- отдельно зафиксировали, что `acknowledged` alert остаётся sticky при очередном detector refresh, пока сам сигнал ещё жив
- перепроверили текущий шаг плана через `backend` test suite, `frontend` production build и `prisma validate`

Зачем:

- честно закрыть пункт roadmap про `Verification`, а не оставлять его на уровне "UI видно и вроде работает"
- снизить риск регрессий в materialized alert feed перед переходом к реальному delivery execution
- удержать документацию в состоянии, где следующий шаг уже действительно начинается с delivery/escalation, а не с добора базового lifecycle coverage

### Ops alert escalation preview over admin contacts

Что сделали:

- backend `ops alerts` store теперь умеет строить `escalation preview` для конкретного alert-а по его `severity/status` и текущим admin contacts
- подняли admin-only endpoint `GET /api/ops/alerts/:alertId/escalation-preview`
- `Ops` UI теперь по кнопке показывает escalation level, recipients и channel preview прямо рядом с persisted alert lifecycle
- добавили unit-test на escalation semantics и синхронизировали `README`, `ROADMAP`, `ARCHITECTURE` и `DEV_SETUP`

Зачем:

- сделать следующий шаг roadmap про delivery path более конкретным: не "кому-нибудь когда-нибудь отправить", а уже иметь готовый recipient/channel preview
- дать администратору возможность видеть внешний delivery object до подключения реальных `Telegram/email` интеграций
- честно сместить следующую очередь уже к delivery execution, а не только к локальному feed или abstract escalation ideas

### Ops alert refresh moved into worker/runtime contour

Что сделали:

- `route-reprobe` worker теперь умеет вызывать refresh persisted `ops alerts` даже когда никто не читает `GET /api/ops/alerts`
- после успешной обработки job refresh форсируется сразу, а в idle-состоянии идёт по отдельному интервалу `OPS_ALERT_REFRESH_INTERVAL_MS`
- добавили unit-test на worker flow, который проверяет, что alert refresh живёт отдельно от UI read-path
- синхронизировали `README`, `ROADMAP`, `ARCHITECTURE` и `DEV_SETUP` с тем, что detector lifecycle уже частично отвязан от summary-read path

Зачем:

- убрать лишнюю зависимость materialized alert lifecycle от открытия `Ops` экрана
- приблизить alerts к настоящему background/runtime объекту, а не только к on-demand read model
- честно сдвинуть следующий шаг roadmap уже к внешнему delivery path или escalation semantics

### Ops alert detector extracted from summary-only path

Что сделали:

- вынесли alert rules в отдельный backend-модуль [backend/src/store/ops-alert-detector.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alert-detector.ts:1)
- `buildRouteDecisionOpsSummary` теперь собирает `operationalSummary.alerts` через общий detector, а не через локальную встроенную ветку условий
- persisted `OpsAlert` feed теперь тоже использует тот же detector поверх summary metrics, а не читает готовые `operationalSummary.alerts` как единственный источник
- добавили проверку в `route-decision-ops` test, что summary-alerts и detector дают один и тот же alert set

Зачем:

- ослабить связку между persisted alert feed и конкретной формой `operationalSummary`
- сделать следующий шаг к более самостоятельному detector lifecycle без дублирования правил
- удержать один источник правды для alert semantics в backend-е

### Persisted alerts feed in Ops UI

Что сделали:

- frontend `useRouteDecisionOps` теперь загружает не только `route-decisions`, но и persisted `ops alerts` feed, а также умеет вызывать `acknowledge / snooze / unacknowledge`
- `Ops` экран теперь показывает отдельную секцию `Persisted alerts feed` с lifecycle-статусом alert-а и явными triage-действиями
- `App` связал новый alert feed с существующим ops-screen flow, без вынесения в отдельный экран
- проверили связку сборками frontend и backend после появления нового UI-контракта

Зачем:

- закрыть следующий UI-шаг плана поверх уже поднятого backend alert feed
- дать администратору возможность не только видеть persisted alert, но и реально менять его lifecycle из интерфейса
- честно сместить следующую очередь уже к более самостоятельному detector lifecycle, а не к отсутствующему UI

### OpsAlert storage and admin API baseline

Что сделали:

- добавили Prisma-модель `OpsAlert` и миграцию `20260707183000_ops_alerts` с persisted lifecycle-полями для `active / acknowledged / snoozed / resolved`
- добавили backend store [backend/src/store/ops-alerts.ts](/Users/miko/Documents/simple-dimple/backend/src/store/ops-alerts.ts:1), который materialize-ит текущие summary-alerts в persisted feed и умеет `list / acknowledge / snooze / unacknowledge`
- расширили state store и admin API endpoint-ами `GET /api/ops/alerts`, `POST /api/ops/alerts/:id/acknowledge`, `POST /api/ops/alerts/:id/snooze`, `POST /api/ops/alerts/:id/unacknowledge`
- зафиксировали `ops_alerts` как часть схемы данных и dev-пути, чтобы следующий шаг уже строился поверх живого backend-контракта

Зачем:

- закрыть первый backend/storage этап плана про `local-first ops alert feed`
- отделить persisted alert lifecycle от вычисляемого `operationalSummary`, чтобы alert можно было увидеть и обработать позже
- подготовить чистую базу под следующий шаг с `Ops` UI и более явным detector lifecycle

### Next step documented as local-first ops alert feed

Что зафиксировали:

- в `ROADMAP`, `ARCHITECTURE`, `README` и `DEV_SETUP` следующий шаг после focused triage layer теперь описан не абстрактно, а как локальный persisted `ops alerts` feed
- отдельно зафиксировали, что первый `alert delivery path` для этого репозитория должен быть внутренним: backend + admin-only UI, без обязательного `Telegram/email/push`
- также зафиксировали, что acknowledge/snooze lifecycle должен жить в БД как рабочий объект, а не быть только вычисляемым summary
- поверх этого добавили и сам рабочий implementation plan: schema -> detector -> store/runtime -> admin API -> ops UI -> verification

Зачем:

- локальный репозиторий пока не требует преждевременного ухода во внешние интеграции
- так проще проверить, действительно ли текущему ops слою нужен отдельный delivery path
- это делает следующую реализацию намного конкретнее: не "придумать ещё alerting", а построить persisted alert feed поверх уже существующего observation trail

### Focused worker/network/job drilldown in Ops

Что сделали:

- расширили `routeReprobeExecution` в `GET /api/ops/route-decisions`: summary теперь возвращает `focusedDrilldowns.worker`, `focusedDrilldowns.network` и `focusedDrilldowns.job`
- backend выбирает один приоритетный `worker`, одну проблемную `network` и один показательный `job trail` поверх уже существующих alerts/hotspots/timeline, чтобы triage начинался с самого шумного среза
- `Ops` экран теперь показывает отдельный блок `Focused triage drilldown` с коротким explainable разбором по worker activity, network degradation и attempt trail конкретной job
- закрепили новый focused drilldown unit-тестом в `route-decision-ops` coverage

Зачем:

- закрыть следующий roadmap-шаг про более focused drilldown для одного `worker/network/job trail`, а не только про широкие summary-карточки
- дать администратору быстрый старт triage без ручного перехода между `worker hotspots`, `network hotspots`, `failure drilldown` и `recent jobs`
- честно сдвинуть следующую очередь уже к решению, нужен ли отдельный alert delivery path или ещё более специализированный surface

### Request-scoped auth sessions instead of process-global auth

Что сделали:

- backend auth-flow перевели с process-global `auth/account` переменных на request-scoped чтение `AuthSession` по `x-auth-session-id`
- `POST /api/auth/logout` теперь ревокает именно текущую auth-сессию, а не создает отдельную случайную `revoked` запись
- frontend теперь сохраняет `auth.id` в `localStorage` и автоматически отправляет его в `x-auth-session-id` для последующих API-запросов
- `GET /api/auth/session`, `GET /api/account`, admin/ops endpoints и route-feedback/probe flows теперь читают auth-контекст из конкретного запроса, а не из общего состояния процесса

Зачем:

- убрать критичный баг, при котором один пользователь мог фактически перетирать auth-состояние другого через общий backend-процесс
- сделать многоклиентный и многовкладочный сценарий хотя бы базово корректным без немедленного внедрения полноценной cookie/session middleware
- перевести auth-контур из dev-single-user допущения в состояние, которое не ломает базовую работоспособность продукта

### Worker-specific alerts and hotspots in Ops

Что сделали:

- расширили `routeReprobeExecution` в `GET /api/ops/route-decisions`: summary теперь возвращает `workerAlerts` и `workerHotspots`, собранные по `workerId` из persisted attempt audit
- `Ops` экран теперь показывает отдельные секции `Worker-specific alerts` и `Worker hotspots`, чтобы triage можно было начинать не с общего timeline, а сразу с проблемного worker-а
- worker-specific слой теперь поднимает dead-letter, lease churn, stale running jobs и retry-heavy workers как отдельные explainable объекты
- закрепили новый worker-specific summary unit-тестом рядом с существующим ops coverage

Зачем:

- закрыть roadmap-развилку про необходимость отдельного worker-specific surface не спором, а рабочим инкрементом
- дать администратору быстрый ответ на вопрос "какой worker шумит" без ручной сверки всех timeline/job карточек
- сдвинуть следующий шаг к ещё более focused drilldown только если этого summary всё ещё окажется недостаточно

### Daily ops history and reprobe network hotspots

Что сделали:

- расширили `GET /api/ops/route-decisions`: `operationalSummary` теперь несет не только hourly history, но и агрегированный `dailyHistory`, а `routeReprobeExecution` получил `networkHotspots`
- `Ops` экран теперь показывает отдельные секции `Daily ops history` и `Job network hotspots`, чтобы длиннее видеть динамику и быстрее находить сети, где одновременно копятся jobs и quality-сигналы
- network hotspot drilldown связывает persisted reprobe jobs с feedback/fallback/degradation сигналами по той же network context группе
- закрепили новый history/hotspot слой unit-тестом в `route-decision-ops` coverage

Зачем:

- сделать следующий ops/history шаг не просто "ещё больше карточек", а более удобным triage слоем для длительной динамики и проблемных сетей
- дать админу быстрый ответ не только на вопрос "что сломалось сейчас", но и "в какой сети это копится уже дольше" без ручной сверки по event trail
- перевести следующую roadmap-развилку к решению, нужен ли вообще отдельный worker-specific alert/drilldown surface

### Worker timeline and failure drilldown for persisted jobs

Что сделали:

- расширили `routeReprobeExecution` в `GET /api/ops/route-decisions`: summary теперь возвращает flattened `timeline` по `attemptAudit` и grouped `failureDrilldown` по recurring failure keys
- `Ops` экран теперь показывает отдельные секции `Worker timeline` и `Worker failure drilldown` поверх persisted jobs
- recurring execution failures теперь читаются как explainable clusters (`boom`, `lease_expired_before_completion` и т.д.), а не как набор разрозненных audit entries
- закрепили новый worker timeline/failure drilldown unit-тестом
- синхронизировали `README`, `ROADMAP`, `DEV_SETUP` и `ARCHITECTURE` с тем, что следующий шаг roadmap теперь уже шире текущего timeline/history слоя

Зачем:

- дать ops/admin слою первый внятный chronology view по worker lifecycle без чтения raw JSON из `route_reprobe_jobs`
- сделать recurring execution failures explainable и triage-friendly
- перевести следующий шаг roadmap от "покажи timeline" к "нужна ли более длинная история и отдельный worker surface"

### Compact hourly ops history

Что сделали:

- расширили `operationalSummary` внутри `GET /api/ops/route-decisions`: теперь он возвращает историю последних почасовых окон с feedback mix, fallback resolves и job lifecycle counts
- `Ops` экран теперь показывает `Recent ops history`, чтобы видеть динамику по окнам, а не только текущий alert/summary срез
- закрепили новый history drilldown unit-тестом в `route-decision-ops` coverage
- обновили `README`, `ROADMAP`, `DEV_SETUP` и `ARCHITECTURE`, чтобы следующий шаг roadmap сместился уже к более длинной истории и ещё более глубоким drilldowns

Зачем:

- дать ops-слою первый temporal drilldown без отдельного timeline endpoint
- сделать route-quality и worker execution наблюдаемыми не только в текущем моменте, но и в ближайшей динамике
- подготовить базу под следующий шаг с ещё более длинной историей или отдельным history surface

### Ops alerting and retention baseline

Что сделали:

- расширили `GET /api/ops/route-decisions`: summary теперь возвращает compact `operationalSummary` с `overallSeverity`, active alerts и retention windows для `probe_reports`, `route_events`, `route_reprobe_jobs`, rollups и rankings
- alert layer теперь поднимает `watch/critical` сигналы поверх overdue queue, dead-letter jobs, SLA breaches и quality backlog после последнего успешного reprobe completion
- `Ops` экран теперь показывает отдельный attention block, чтобы админ видел не только counters, но и что именно требует внимания прямо сейчас
- зафиксировали retention и alert semantics в `DB_SCHEMA`, `ROADMAP`, `DEV_SETUP`, `ARCHITECTURE` и `README`
- закрепили новый operational summary unit-тестом в существующем route-decision ops coverage

Зачем:

- закрыть roadmap-шаг про alerting/retention вокруг worker health и route-quality observation
- дать ops-слою короткий attention summary без необходимости вручную читать все dashboards и event trail
- перевести следующий шаг roadmap от базового alerting к более длинной истории и richer drilldowns

### Job-level drilldowns and execution impact in Ops

Что сделали:

- расширили `GET /api/ops/route-decisions`: summary теперь возвращает `executionImpact`, который связывает worker execution с route-quality сигналами через `last successful completion`, свежие quality events, fallback resolves и деградировавшие сети
- recent reprobe jobs в том же ops summary теперь несут более явный job-level drilldown: network quality impact по сети job, active degradation flag и candidate health context
- обновили `Ops` экран, чтобы recent jobs было можно читать как decision-friendly drilldown без ручной сверки по raw `route_events`
- синхронизировали `README`, `ROADMAP`, `DEV_SETUP` и `ARCHITECTURE`, чтобы ближайшая очередь теперь честно сместилась к alerting/retention, а не продолжала ссылаться на уже завершённый шаг
- зафиксировали новый job-level drilldown unit-тестом рядом с существующим ops summary coverage

Зачем:

- закрыть roadmap-переход от "worker execution показывается рядом" к "worker execution объяснимо влияет на route-quality observation"
- сделать следующий инкремент про alerting/retention осмысленным, опираясь уже на связанный ops trail, а не на разрозненные counters
- держать документацию в состоянии, где она отражает текущий код, а не вчерашний план

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

## 2026-07-07

### Code review findings — исправлены расхождения документации с кодом

Что сделано:
- `frontend/types/route.ts` — `TelemetryNetworkContext` расширен до полного контракта бэка (networkType?, carrier?, asn?, countryCode?, region?)
- `frontend/lib/network.ts` — `buildRouteContext()` теперь собирает `networkType` + `carrier`; `submitProbeReport()` шлёт `x-auth-session-id`
- `frontend/types/session.ts` — `SessionResponse.servers` сделан `optional` (resp. `/api/connect`)
- `frontend/hooks/useRouteSession.ts` — fallback `data.servers ?? []`
- `frontend/src/App.tsx` — удалён дубликат `return`
- `docs/CODE_REVIEW.md` — создан документ ревью с таблицей статусов
- `docs/DEV_SETUP.md` — endpoint list синхронизирован с реальностью (25 endpoints)
- `docs/ARCHITECTURE.md` — seedDefaultData описан как удалённый, добавлен withStateLock()
- `docs/DECISIONS.md` — Decision 014/015 уточнены про удаление seed
- `docs/README.md` — добавлена ссылка на CODE_REVIEW.md

Зачем:
- синхронизировать документацию с текущим состоянием кода, чтобы следующий разработчик не тратил время на расследования расхождений
