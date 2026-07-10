# Changelog

Этот файл нужен для краткой хронологии изменений по проекту.

Формат простой:

- дата
- что было сделано
- зачем это было сделано

## 2026-07-10

### UI/UX: Ops убран из главного экрана обычного пользователя, нативный touch-feel, статус-бар под тему на Android

Что сделали: `Ops`-кнопка на главном экране вела себя не так, как `Admin` —
`Admin` не рендерился для не-админа, `Ops` рендерился всегда и просто
дизейблился. Приведено к одинаковому поведению
(`frontend/src/components/HomeScreen.tsx`). Добавлен CSS для "нативного"
touch-feel вместо ощущения браузерной страницы: `touch-action: manipulation`
+ убранный tap-highlight, press-feedback (`:active { scale(0.96) }`),
`overscroll-behavior: none`, `user-select: none` на кнопках, safe-area-инсеты
через `env(safe-area-inset-*)` + `viewport-fit=cover` (`styles.css`,
`index.html`). Установлен `@capacitor/status-bar@7.0.6` (обе `package.json`),
статус-бар на Android теперь окрашен в тот же navy (`#0f172a`), что и тема
приложения (`App.tsx`), no-op в браузере/PWA. `npm run test --workspace
frontend` (11/11), `check`, `lint` — зелёные. **APK пересобран**:
`cap sync android` подтянул нативный код плагина, `./gradlew
:app:assembleDebug` → `BUILD SUCCESSFUL`. Подробности и что не проверено
вживую (реальный запуск этой сборки на устройстве) — [Decision
049](DECISIONS.md).

Зачем: WebView-приложение не обязано ощущаться как сайт в браузере — это
лечится CSS и native-плагинами Capacitor, без переписывания на другой стек.

### Этап 8 (`ROADMAP.md`) закрыт: telemetry-очередь на клиенте, отчёты больше не теряются молча

Что сделали: перед переходом к следующему этапу после закрытия Этапа 7
сверили `ROADMAP.md, Этап 8` с кодом и нашли реальный пробел — оба места,
отправляющие telemetry (`submitProbeReport` в `frontend/src/lib/network.ts`,
`reportCandidateFailure` в `frontend/src/hooks/useRouteSession.ts`), при
неудачной отправке просто теряли отчёт в `catch`-блоке. Добавлен
`frontend/src/lib/telemetryQueue.ts` — localStorage-очередь (кап 20
записей) с `enqueueTelemetryReport()`/`flushTelemetryQueue()`; оба места
теперь кэшируют неотправленный отчёт вместо потери, `flushTelemetryQueue()`
вызывается при старте приложения в `App.tsx`. 5 новых unit-тестов
(`telemetryQueue.test.ts`). `npm run test --workspace frontend` (11/11),
`npm run check --workspace frontend`, `npm run lint` — зелёные. Подробности
— [Decision 048](DECISIONS.md).

Зачем: единичный сетевой сбой не должен означать потерянный сигнал о
доступности сервера — именно эту гарантию явно требовал `ROADMAP.md, Этап 8`,
и до этого изменения она не выполнялась.

### Inventory policy: порог независимых failure domains снижен 3 → 2 (бюджетное ограничение)

Что сделали: `MINIMUM_INDEPENDENT_FAILURE_DOMAINS` в
`backend/src/inventory-policy.ts` снижен с 3 до 2 — третий VPS у отдельного
провайдера сейчас не берём (бюджет ограничен), а держать 2 fake-лейбла
(`Germany Test Node`/`Netherlands Test Node`) на одном OVH-хосте только
ради формального прохождения policy — нечестно. Обновлены тесты
(`inventory-policy.test.ts`, `endpoints.test.ts`, `route-decision-ops.test.ts`),
добавлен явный тест на "2 независимых домена = compliant".
`npm run test --workspace backend` (269/269), `npm run typecheck` — зелёные.

**Доведено до конца вживую в тот же день:** `deploy/manual-deploy.sh`
прогнан на оба боевых VPS (OVH `57.128.220.83`, Contabo `167.86.77.100`) —
новый порог реально выкачен в прод (`200`/`401` на обоих после деплоя).
После деплоя обе fake-ноды (`Germany Test Node`, `Netherlands Test Node`)
не retired, а физически удалены из `Endpoint` прямым `DELETE` в psql — это
были тестовые записи без единого реального сервера позади. Лейбл
оставшейся честной OVH-ноды переименован в `France OVH Node` — убран
устаревший хвост `[TEST: co-located on single VPS, ...]`, который вводил в
заблуждение после того, как co-location больше не существует. Живой
инвентарь теперь — ровно 2 честные записи (OVH, Contabo), без единого
fake-лейбла в базе. Порядок операций важен и задокументирован отдельно:
деплой кода **до** удаления нод, иначе старый backend с порогом 3 включил
бы fail-closed policy на всех `session`/`connect` запросах у реальных
пользователей. Подробности и осознанный trade-off (отказоустойчивость ниже
изначальной цели `Этапа 7`) — [Decision 047](DECISIONS.md).

Зачем: не жертвовать честностью инвентаря ради формального прохождения
policy, когда бюджет реально не позволяет третьего провайдера прямо сейчас.

### Шаг 7 (`PRIORITY_PLAN.md`): аудит alerting-слоя — новый код не потребовался

Что сделали: перед тем как брать новую работу по ops/alerting (разморожено
после закрытия Шагов 1-6), сверили пятипунктовый рабочий план
`ROADMAP.md, Этап 6` с реальным кодом. Весь план — external Telegram/email
delivery adapter, escalation semantics (immediate/digest/cooldown/cadence/
quiet-window), metadata reuse, admin controls (digest toggle, manual
resend) — уже реализован в `backend/src/store/ops-alerts.ts` и соседних
модулях, написан ещё до заморозки. Подтверждено: `npm run test --workspace
backend` (268/268), manual resend и digest-toggle проверены как подключённые
в UI, а не только в API. Подробности и оставшиеся открытые пункты (живая
проверка внешней доставки, вопрос про отдельный specialized surface) —
[Decision 046](DECISIONS.md).

Зачем: не переизобретать уже сделанную работу и явно зафиксировать в
документах, что `Этап 6` фактически закрыт, прежде чем брать следующий шаг.

### UI-баг: кнопка «Автопродление включено» на экране Аккаунт не имела обработчика

Что сделали: живой прогон всех кнопок UI (см. Шаг 2b ниже) нашёл, что
кнопка автопродления на [AccountScreen.tsx](../frontend/src/components/AccountScreen.tsx)
рендерилась как `<button>` без `onClick` — backend не имеет эндпоинта для
переключения `subscription.autoRenew`, кнопка была не более чем статус-лейбл,
но выглядела кликабельной. Заменена на `<span className="statusBadge">`
(`cursor: default` в [styles.css](../frontend/src/styles.css)) — теперь не
значится как интерактивный элемент ни визуально, ни в accessibility-дереве.

Зачем: элемент, который выглядит как кнопка, но ничего не делает по клику —
вводит пользователя в заблуждение. Настоящий toggle для `autoRenew` не
реализован — если понадобится, это отдельная задача (нужен backend-эндпоинт).

### Шаг 2b (завершение): сквозная доставка трафика подтверждена на реальном Android-устройстве — найдены и исправлены 3 реальных бага

Что сделали (см. [DECISIONS.md, Decision 045](DECISIONS.md) за деталями):

- добавлена `resolveApiUrl()` в
  [frontend/src/lib/http.ts](../frontend/src/lib/http.ts) — на native
  (Capacitor) все запросы уходят на абсолютный control-plane URL, а не по
  относительному пути, который в WebView резолвится в никуда;
- root CA control-plane (`tls internal`, Decision 040) вшит в APK
  ([mobile/android/app/src/main/res/raw/caddy_root_ca.crt](../mobile/android/app/src/main/res/raw/caddy_root_ca.crt) +
  `network_security_config.xml`) — телефон доверяет self-signed
  сертификату без ручной установки;
- `SimpleDimpleVpnService.kt` теперь регистрирует `libXray.DialerController`
  (`protect(fd)`) — без этого исходящие соединения Xray-core перехватывались
  собственным `tun`-интерфейсом (self-loop), поэтому трафик не проходил ни
  на эмуляторе (Decision 035), ни на реальном устройстве;
- `deploy/xray/sync-clients.sh` не был живым cron'ом ни на одной из 4 нод
  (на Contabo не установлен вообще, на OVH дёргал `http://localhost:8080` —
  порт, закрытый ещё в Decision 041) — новые пользователи никогда не
  попадали в `inbound.settings.clients`. Cron переставлен на обоих VPS,
  root CA добавлен в системное доверие хостов.

Зачем: это был последний открытый пункт всего `PRIORITY_PLAN.md` (Шаг 2b) —
живая проверка на настоящем телефоне отличает "туннель поднимается" от
"продукт реально выполняет своё центральное обещание". Все три бага были
инфраструктурными — ни один не ловился юнит-тестами или эмулятором.

### Линтер, переименование ошибки store-слоя, разбиение трёх файлов-гигантов

Что сделали:

- **ESLint** — репозиторий раньше проверялся только `tsc`, без линтера
  вообще; добавлен flat config [eslint.config.js](../eslint.config.js)
  (ESLint 9 + `typescript-eslint` + `eslint-plugin-react-hooks` для
  frontend), корневой скрипт `npm run lint`, шаг в `ci.yml` перед
  `ci:check`. Первый прогон сразу нашёл: 6 реальных ошибок (необъявленные
  Node-глобалы в `backend/scripts/wait-for-db.mjs`, `any` в тестовом
  Prisma-моке) и ~25 мёртвых импортов (`state-store.ts`, `store/utils.ts`,
  `store/admin.ts`, `store/session.ts`, `types/session.ts`) — все удалены.
  Отдельно — 4 варнинга `react-hooks/exhaustive-deps` в
  [App.tsx:55-94](../frontend/src/App.tsx): диагностированы как
  **намеренно неполные deps** (хуки `useAuthAccount`/`useRouteSession`/etc.
  возвращают новый объект на каждый рендер, добавление объекта в deps
  вызвало бы ре-фетч на каждый рендер) — задокументированы инлайн
  комментарием + точечным `eslint-disable-next-line`, а не глобальным
  отключением правила.
- **`StoreAuthError` → `StoreError`** — класс кидался не только на auth-ошибки
  (401/403/429), но и на `404 Not found`, `409 conflict`, `503 policy
  violation`; имя вводило в заблуждение. Переименован в
  [store/utils.ts](../backend/src/store/utils.ts) + все ~25 использований в
  `auth.ts`, `admin.ts`, `session.ts`, `endpoints.ts` и тестах.
- **`store/admin.ts` разбит** (был 1884 строки, из них
  `buildRouteDecisionOpsSummary` — один ~770-строчный экспорт):
  [admin.ts](../backend/src/store/admin.ts) (263 строки) теперь только
  `createAdminStore` (Prisma CRUD); чистые билдеры аналитики вынесены в
  [route-decision-ops.ts](../backend/src/store/route-decision-ops.ts) (796),
  [route-reprobe-execution-summary.ts](../backend/src/store/route-reprobe-execution-summary.ts) (673)
  и общий слой хелперов/типов
  [ops-summary-shared.ts](../backend/src/store/ops-summary-shared.ts) (202) —
  оба билдера делят одни и те же pure-функции (`median`, `percentile`,
  `buildNetworkContextKey` и т.д.), поэтому вынесены в третий файл, а не
  продублированы.
- **`frontend/src/components/OpsScreen.tsx` разбит** (был 1509 строк) на
  директорию [components/ops-screen/](../frontend/src/components/ops-screen/)
  из 11 файлов: `formatters.ts`, `tiles.tsx` (простые презентационные тайлы),
  `PersistedAlertTile.tsx` (сложный интерактивный тайл — отдельно), семь
  файлов-секций по доменам дашборда (`AlertsAndAttentionSections.tsx`,
  `FleetAndHistorySections.tsx`, `FocusedDrilldownSection.tsx`,
  `WorkerExecutionSections.tsx`, `NetworkAndTimelineSections.tsx`,
  `QualityAndPressureSections.tsx`, `JobsEndpointsNetworksEventsSections.tsx`)
  и `OpsScreen.tsx` (266 строк) — точка входа, которая теперь только
  композирует секции и передаёт им узкий срез `ops`, а не весь объект целиком.
- **`store/ops-alerts.ts` разбит** (был 1213 строк) — чистые куски вынесены в
  [ops-alert-mappers.ts](../backend/src/store/ops-alert-mappers.ts) (122,
  мапперы DB-строка → API-тип), [ops-alert-messages.ts](../backend/src/store/ops-alert-messages.ts) (96,
  билдеры текста алертов/дайджеста), [ops-alert-escalation.ts](../backend/src/store/ops-alert-escalation.ts) (104,
  `buildOpsAlertEscalationPreview`) и [ops-alert-time-window.ts](../backend/src/store/ops-alert-time-window.ts) (35,
  чистые UTC-хелперы). `createOpsAlertStore` (883 строки) остался в
  `ops-alerts.ts` — cooldown/cadence/quiet-window policy-функции сознательно
  не вынесены наружу: они завязаны на `prisma` + `getNow`-замыкание, а сам
  файл уже объясняет комментарием, почему store-методы держатся на одном
  объекте (`this`-биндинг, на который завязан `state-store.ts`).

Зачем:

- линтер — самый дешёвый способ поймать баг класса "забыл dependency в
  useEffect" или "мёртвый импорт" до код-ревью, а не после;
- `StoreError` — имя ошибки, которое не врёт про то, когда оно кидается;
- три разбиения файлов — тот же мотив, что и раньше для `state-store.ts`
  (Decision, см. секцию "Storage layer: modular decomposition" в
  [ARCHITECTURE.md](ARCHITECTURE.md)): нельзя было менять один домен, не
  пролистывая тысячи строк соседних.

Проверено: `npm run lint` (0 ошибок/варнингов), `npm run typecheck`
backend+frontend, `npm run test` backend (268/268) и frontend (6/6) —
зелёные после каждого шага. `OpsScreen.tsx`-рефакторинг дополнительно
проверен вручную в браузере (dev-сервер поднимается, рендер без ошибок в
консоли); полный дашборд с реальными ops-данными не проверялся живьём — для
этого нужен запущенный backend с БД и авторизованный admin-пользователь,
что вне скоупа чисто структурного рефакторинга.

### Code review findings — устранены 4 находки по дублированию/типизации в backend

Что сделали:

- **Admin-guard дублировался ~15 раз** в `routes/admin.ts`, `routes/ops-alerts.ts`,
  `routes/ops-reprobe.ts` — паттерн `getRequestAuthContext` + `requireAdminAuthSession` +
  ранний `return { error }` копипастился в каждом хендлере (~200 строк). Добавлена
  обёртка `withAdminAuth(runtime, handler)` в
  [routes/context.ts](../backend/src/routes/context.ts): резолвит auth-context, отсекает
  неадминов единым `{error}`/401/403 ответом, прокидывает `context` в хендлер третьим
  аргументом (нужно для `context.auth.userId` в паре мест). Обычная function-wrapper,
  а не Fastify `preHandler`-хук — хендлерам нужен резолвленный `context` дальше по коду,
  а preHandler потребовал бы декорировать `request` ради того же результата.
- **`activateCredentialsSession` / `activateSessionForProvider`** в
  [store/auth.ts](../backend/src/store/auth.ts) отличались только маппингом `provider` →
  `AuthProvider`-enum (тернарная цепочка). Сведены в один `activateSession(userId, provider)`;
  маппинг заменён на `AuthProvider[provider]`, так как ключи enum совпадают со строковыми
  литералами 1:1.
- **Хвостовой import** `normalizeVerificationTarget` в конце `auth.ts` (работал только
  за счёт hoisting) — перенесён в общий блок импортов `./utils.js` сверху файла.
- **`writeState` vs `writeSession`** в [store/session.ts](../backend/src/store/session.ts) —
  `writeState` делал полный upsert user/authSession/subscription/devices, но использовался
  только в одном месте (`routes/account.ts`, обновление профиля), где аккаунт уже
  гарантированно существует в БД (сессия авторизована). Заменён на узкий
  `updateAccountProfile(userId, patch)` — один `prisma.user.update` по трём полям профиля.
  Заодно убран теперь-неиспользуемый тип `PersistedState` из `types.ts`.
- **`getOpsSummary` возвращал `Record<string, unknown>`** в
  [store/admin.ts](../backend/src/store/admin.ts) — типизация ответа терялась. Добавлен
  именованный тип `AdminOpsSummary` в `types.ts` (users/subscriptions/connections/
  timeWindowMinutes/computedAt + опциональный `probeStats`).

Зачем:

- меньше copy-paste — один admin-guard баг чинится в одном месте, а не в 15;
- явные типы (`AdminOpsSummary`, узкая сигнатура `updateAccountProfile`) ловят рассинхрон
  между store и route-слоем на этапе компиляции, а не в рантайме;
- `writeState` был избыточен по стоимости (5 таблиц вместо одной) для единственного
  вызова, который менял только профиль.

Проверено: `npm run typecheck` и `npm run test` backend (268/268) — зелёные после
каждого шага. Изменения не затрагивают UI/dev-сервер, живая проверка в браузере не
требовалась.

## 2026-07-09

### Шаг 2b: живая проверка на Android-эмуляторе — VpnService реально активируется, сквозной трафик не подтверждён

Что сделали:

- поднят реальный Android-эмулятор (AVD, `android-34`/`google_apis`/
  `arm64-v8a`) — раньше эмулятор не запускался ни разу (был только тулинг
  для сборки, [Decision 028](DECISIONS.md));
- реальный вход/регистрация в приложении против живого backend на VPS1
  (через `chrome://inspect`-совместимый CDP, не инъекция localStorage);
- нажатие "Подключить" реально вызвало системный диалог Android
  `Connection request` — `VpnService.prepare()` дошёл по-настоящему;
  после согласия поднялся `tun`-интерфейс с параметрами из
  `SimpleDimpleVpnService`, Xray-core на устройстве реально дозвонился до
  порта Contabo-ноды.

Не подтверждено:

- сквозная доставка трафика через туннель — `fetch` из WebView не проходит,
  на стороне Contabo-ноды не видно входящих соединений от эмулятора;
  неясно, ограничение ли это эмулятора или реальный баг — нужна проверка на
  физическом устройстве;
- найден (не исправлен) баг гонки: параллельные Xray-core/tun инстансы при
  быстрых повторных попытках подключения не останавливают предыдущий.
  Подробности — [DECISIONS.md, Decision 035](DECISIONS.md).

Зачем:

- впервые проверяет нативный VPN-код на реальной Android-системе, а не
  только по факту компиляции — подтверждает часть Definition of done Шага
  2b (UI/permission flow), но не всю (сквозной трафик).

### Шаг 5: Ansible-автоматизация fleet provisioning написана и проверена вживую

Что сделали:

- `deploy/ansible/` — playbook'и `provision-node.yml`/`retire-node.yml`/
  `reactivate-node.yml` + роль `xray_node`, Ansible-эквивалент
  `deploy/xray/provision-node.sh` для случая, когда нод/провайдеров больше
  одного за раз;
- в отличие от bash-скрипта — идемпотентна: crypto-материал читается
  обратно с диска на повторных прогонах вместо перегенерации, регистрация
  проверяет `poolCode` перед `POST`;
- прогнано вживую на тестовом pool на существующем OVH VPS: провижининг,
  повторный прогон (`changed: 0`, идемпотентность подтверждена),
  retire/reactivate — всё сработало. По пути найдены и исправлены 2 бага в
  автоопределении IP (HTML вместо IP из-за User-Agent; IPv6 вместо IPv4 на
  dual-stack хосте). Тестовый pool снесён после проверки. Подробности —
  [DECISIONS.md, Decision 034](DECISIONS.md).

Зачем:

- закрывает единственный пробел Шага 5, отложенный ещё в Decision 025
  ("нет реальных 2-3 VPS у разных провайдеров") — теперь VPS два, условие
  больше не в силе.

### Шаг 4: `manual-deploy.sh` прогнан вживую против реального VPS

Что сделали:

- `deploy/manual-deploy.sh` запущен с локальной машины против VPS2
  (Contabo) — чистый хост без предыдущего деплоя backend/frontend;
- аутентификация паролем через `sshpass`-обёртку поверх `ssh` (сам скрипт не
  менялся);
- с первого раза, без ручных правок: rsync → миграции → `up --build -d` →
  `postgres`/`backend`/`frontend`/`route-reprobe-worker` все `Up`,
  `GET /api/session` → `401`, `GET /` → `200`. Подробности —
  [DECISIONS.md, Decision 033](DECISIONS.md).

Зачем:

- закрывает единственный пункт Шага 4, помеченный как непроверенный —
  реальный прогон деплой-пути против реального сервера, а не только
  `docker compose` на dev-машине;
- deploy-job'ы `ci.yml` (`deploy-staging`/`deploy-prod`) сознательно
  остаются непроверенными — нужен GitHub remote/secrets, отдельное
  действие вне скоупа этой проверки.

### Шаг 3: auto-fallback executor проверен вживую (реальный provал → реальный fallback между двумя VPS)

Что сделали:

- `connectWithFallback()` из `frontend/src/lib/connectFallback.ts` вызван
  напрямую отдельным `tsx`-скриптом с реальными зависимостями: реальные
  HTTP-запросы к живому backend (`routes/resolve`, `routes/feedback`),
  реальный `xray-core`-клиент для каждой попытки туннеля;
- primary-нода (Contabo) остановлена через `docker stop` прямо на VPS —
  настоящий, не эмулированный провал; executor поймал отказ, отправил
  feedback, переключился на кандидата №2 (OVH) и получил рабочий туннель
  (`curl` вернул `57.128.220.83`);
- подтверждено, что feedback реально долетает и учитывается: `GET
  /api/session` после теста показал `routeHealth` с настоящим
  `penaltyScore`/`connect_refused` для упавшей ноды. Подробности —
  [DECISIONS.md, Decision 031](DECISIONS.md).

Зачем:

- закрывает Definition of done Шага 3 (кроме прогона через настоящую
  native-кнопку на Android-устройстве — это отдельно висит на Шаге 2b);
- раньше исполнитель был проверен только юнит-тестами с моками — теперь
  подтверждено, что вся цепочка (executor → живой backend → живые
  Xray-ноды → feedback → routeHealth) реально работает end-to-end.

### Второй реальный VPS (Contabo) — IP-ротация между двумя независимыми хостами подтверждена вживую

Что сделали:

- подключён второй, физически отдельный VPS — `167.86.77.100` (Contabo
  GmbH, `AS51167`, Франция), данные в `deploy/ssh.env`
  (`vps_ip`/`vps_user`/`vps_password`);
- установлен Docker, через `deploy/xray/provision-node.sh register` поднят
  настоящий `xray-core` inbound (VLESS+REALITY+TCP, pool `fr-contabo-1`) и
  зарегистрирован в control-plane (backend на первом VPS,
  `http://57.128.220.83:8080`) с честными provider/ASN/country, без пометки
  `[TEST: co-located...]`;
- `deploy/xray/sync-clients.sh` прогнан вручную — реальные `User.vlessUuid`
  подтянулись в конфиг новой ноды;
- **живая проверка IP-ротации**: `POST /api/routes/resolve` выдал
  `connectionConfig` на новую ноду → локальный `xray-core` клиент → `curl`
  через SOCKS5 вернул `167.86.77.100`; затем нода переведена в
  `isActive: false` (симуляция отказа) → повторный `routes/resolve`
  вернул fallback на первый VPS → `curl` вернул `57.128.220.83`; нода
  возвращена в `isActive: true` после проверки. Подробности —
  [DECISIONS.md, Decision 030](DECISIONS.md).

Зачем:

- частично закрывает пробел из Decision 025 ("3 инбаунда на одном и том же
  VPS, 2 из 3 provider/ASN/region в БД фейковые" — первый VPS сам по себе
  честно OVH, `AS16276`, подтверждено whois; фейковые только Hetzner- и
  DigitalOcean-лейблы на том же хосте) — впервые в проекте backend реально
  переключает маршрут между двумя разными физическими хостами (OVH и
  Contabo), а клиент реально следует за этим изменением IP, а не только
  внутри одного VPS;
- теперь 2 из 4 endpoint'ов в БД подкреплены физически разными хостами
  (было 1 из 4) — остаётся ещё 2 fake-лейблированных инбаунда на первом
  (OVH) хосте, которые нужно заменить реальными VPS у ещё 1 провайдера,
  прежде чем retire-ить их.

### Шаг 2b: `startTunnel()`/`SimpleDimpleVpnService` реализованы поверх `XTLS/libXray`, APK собирается с реальным Xray-core

Что сделали:

- выбрана mobile-библиотека Xray core: `XTLS/libXray`, собрана в `.aar`
  через `gomobile bind` (пинный тег `v26.6.27`, синхронный с
  `xray-core`-зависимостью самого `libXray`);
- установлен тулинг для сборки: Go 1.25, `gomobile`, Android NDK
  `28.2.13676358` (~2.8GB);
- **архитектура упрощена**: у Xray-core оказался встроенный `tun` inbound
  (gVisor userspace stack, читает fd напрямую через env `xray.tun.fd`) —
  отдельный tun2socks-мост (`hev-socks5-tunnel`), заложенный в
  первоначальном плане, не понадобился;
- `VpnTunnelPlugin.kt`: `startTunnel()` строит Xray JSON-конфиг
  (`buildXrayConfig()` — один `tun` inbound + один `vless`+`reality`
  outbound из `tunnelParams`), пишет в `filesDir`, стартует
  `SimpleDimpleVpnService` через `Intent`, ждёт колбэка через статический
  мост (`PluginCall` нельзя передать в `Service` напрямую);
- `SimpleDimpleVpnService.kt` (новый файл, вынесен из `VpnTunnelPlugin.kt`):
  `Builder.establish()` → `LibXray.setTunFd()` → `LibXray.runXrayFromJSON()`,
  foreground-уведомление, `onRevoke()` для корректной остановки при отзыве
  VPN-consent из системных настроек;
- `AndroidManifest.xml`: `<service>` с `VpnService` intent-filter,
  разрешения `FOREGROUND_SERVICE`/`FOREGROUND_SERVICE_SPECIAL_USE`/
  `POST_NOTIFICATIONS`;
- API-контракт `libXray.aar` на пинном теге проверен через `javap` по
  реально собранным `.class`, а не по README `main`-ветки — они разошлись
  (README описывает более новый `Invoke()`-dispatcher, которого на
  `v26.6.27` ещё нет);
- формат VLESS+REALITY JSON-конфига подтверждён по исходникам Xray-core
  (`infra/conf/vless.go`, `transport_security.go`, `tun.go`), не по памяти;
- `libXray.aar` (~95MB) не коммитится — `mobile/native-libs/` и
  `android/app/libs/*.aar` в `.gitignore`, README документирует пересборку;
- `./gradlew :app:assembleDebug` → **`BUILD SUCCESSFUL`**, `libgojni.so`
  реально влинкован во все 4 ABI итогового APK (проверено `unzip -l`, не
  только по логам сборки). Подробности — [DECISIONS.md, Decision
  029](DECISIONS.md).

Зачем:

- закрывает по коду единственный оставшийся пункт Definition of done Шага
  2b — `startTunnel()`/`SimpleDimpleVpnService` были `TODO`, теперь
  реализованы и компилируются с реальным Xray-core;
- единственное, что осталось — живая проверка на реальном
  устройстве/эмуляторе (нет AVD, `adb install` не выполнялся). До этого
  код "документированно корректен по API Xray-core", но не "подтверждённо
  работает".

### Шаг 2b: впервые собран Android-тулинг, `VpnTunnelPlugin.kt` реально компилируется, собран debug APK

Что сделали:

- поставили через Homebrew весь Android-тулинг, которого раньше не было в
  этой среде: `gradle`, `android-commandlinetools` (`sdkmanager`/`adb`),
  `platform-tools`, `platforms;android-34`/`android-35`,
  `build-tools;35.0.0`, `openjdk@17`/`openjdk@21` (keg-only, не подменяют
  системный `java`);
- `cd mobile && npm install && npx cap add android` — впервые сгенерирован
  реальный Gradle-проект `mobile/android/`;
- `android-skeleton/VpnTunnelPlugin.kt` скопирован в
  `android/app/src/main/java/com/simpledimple/app/VpnTunnelPlugin.kt`,
  зарегистрирован в `MainActivity.java` (`registerPlugin(VpnTunnelPlugin.class)`
  — этого не было в черновике);
- добавили Kotlin в Gradle-конфиг (`kotlin-gradle-plugin` в
  `android/build.gradle`, `kotlin.android` plugin + `kotlin-stdlib` в
  `android/app/build.gradle`) — `cap add android` не подключает Kotlin по
  умолчанию;
- перебрали 3 JDK, прежде чем сборка прошла: `openjdk@17` не хватило
  (`capacitor-android` требует `--release 21`), `openjdk@26` оказался
  слишком новым (`jlink`/`androidJdkImage` ломается на AGP 8.7.2),
  `openjdk@21` — сработал;
- `./gradlew :app:assembleDebug` → **`BUILD SUCCESSFUL`**, `compileDebugKotlin`
  прошёл без ошибок, `app-debug.apk` (~4.16MB) реально собран. Подробности
  и обоснование версий — [DECISIONS.md, Decision 028](DECISIONS.md).

Зачем:

- закрывает первый пункт очереди из
  [mobile/README.md](../mobile/README.md) ("Что нужно сделать в первую
  очередь, когда появится Android-тулинг") — `VpnTunnelPlugin.kt` был
  написан по памяти о Capacitor Android bridge API, без компилятора; теперь
  подтверждено, что API использованы корректно;
- `startTunnel()`/`SimpleDimpleVpnService` остаются `TODO` — реальный
  VPN-туннель на устройстве всё ещё не поднимается, нужна mobile-сборка
  Xray core (выбор `.so`/AAR — отдельное решение). Definition of done Шага
  2 по нативному клиенту по-прежнему не закрыт, но "код без сборки" для
  Kotlin-стороны — закрыт.

### Шаг 4: первый живой прогон `docker compose --profile prod build/up` — найден и воспроизведён краш backend на чистой БД

Что сделали:

- впервые в жизни проекта собрали `backend/Dockerfile` и
  `frontend/Dockerfile` через `docker compose --profile prod build` —
  Docker оказался доступен в этой среде, вопреки более ранней записи в
  [PRIORITY_PLAN.md](PRIORITY_PLAN.md), что его нет. Оба образа собрались
  чисто с первого раза;
- на чистом `postgres_data` volume `docker compose --profile prod up`
  запускает backend в crash-loop: `P2021 TableDoesNotExist`
  (`relation "public.AuthSession" does not exist`) — корневой
  [compose.yaml](../compose.yaml) profile `prod` (локальный smoke-test для
  Dockerfile'ов) не содержит шага миграций, в отличие от
  [deploy/compose.prod.yaml](../deploy/compose.prod.yaml), где есть
  одноразовый сервис `migrate`. Раньше это было предположением из плана,
  теперь — воспроизведённый краш;
- после ручного `prisma migrate deploy` (внутри docker-сети, на реальный
  контейнер `postgres`, не на хостовый) backend поднимается и корректно
  отвечает (`GET /api/session` → `401 Authentication required`), frontend
  отдаёт собранный PWA через nginx (`GET /` → `200`);
- побочная находка: на этой машине на `localhost:5432` уже слушает
  нативный (не Docker) Postgres-процесс. Прогон `prisma migrate deploy` с
  хоста на `localhost:5432` тихо подключился к этому нативному процессу
  вместо контейнера и соврал "No pending migrations to apply", хотя
  контейнерная БД оставалась пустой — реальная ловушка при диагностике с
  хоста, где параллельно поднят dev-Postgres;
- **в тот же день закрыт**: добавлен сервис `migrate` в корневой
  [compose.yaml](../compose.yaml) (тот же паттерн, что в
  `deploy/compose.prod.yaml`) — `backend` теперь ждёт
  `migrate: condition: service_completed_successfully`. Проверено вживую
  на чистом volume: `docker compose --profile prod up --build` сам гоняет
  миграции и поднимает рабочий стек без ручного вмешательства (`GET
  /api/session` → `401`, `GET /` frontend → `200`);
- деплой-jobs в `ci.yml` (`deploy-staging`/`deploy-prod`) и реальный
  прогон на VPS через `deploy/manual-deploy.sh` по-прежнему не проверены —
  вне скоупа этого прогона (нет secrets/environments и доступа к
  реальному серверу в этой среде).

Зачем:

- закрывает статус Шага 4 в [PRIORITY_PLAN.md](PRIORITY_PLAN.md) по части
  build/up — образы реально собираются, стек реально поднимается на
  чистой БД без ручных шагов;
- убирает расхождение между локальным smoke-test path (`compose.yaml`,
  profile `prod`) и настоящим deploy path (`deploy/compose.prod.yaml` +
  `manual-deploy.sh`) — раньше тестируя первый можно было решить, что
  деплой рабочий, а получить crash-loop на VPS с чистой БД.

Проверено: `docker compose --profile prod build` (оба образа + migrate),
`up --build` на чистом volume — `migrate` отрабатывает первым, `backend`
и `frontend` поднимаются и отвечают корректно, без ручного вмешательства.
Не проверено: `ci.yml` deploy-jobs с реальными secrets, прогон
`deploy/manual-deploy.sh` на реальном VPS.

### Шаг 5 (завершение): retire-аудит в Ops + два бага, найденных живой browser-проверкой

Что сделали:

- миграция `20260709150000_endpoint_retire_audit` — `Endpoint.retiredAt`/
  `retiredReason`;
- `setEndpointActive()` в
  [backend/src/store/endpoints.ts](../backend/src/store/endpoints.ts)
  проставляет `retiredReason` (по умолчанию `"manual"`, либо кастомный текст
  из `PATCH /api/admin/endpoints/:id`) и чистит оба поля при реактивации;
- `applyHealthCheckResult()` в
  [backend/src/store/endpoint-healthcheck.ts](../backend/src/store/endpoint-healthcheck.ts)
  различает manual retire (не реактивируется сам на успешный пинг, только
  обновляет метрики) от auto-detected (`retiredReason: "auto_health_failure"`,
  по-прежнему само восстанавливается — прежнее поведение, но теперь
  промаркировано);
- Ops UI ([frontend/src/components/OpsScreen.tsx](../frontend/src/components/OpsScreen.tsx))
  показывает причину и время retire на карточке неактивной ноды;
- 6 новых unit-тестов (2 в `endpoints.test.ts`, 4 в
  `endpoint-healthcheck.test.ts`) — итого 191/191 backend;
- по пути живой browser-проверкой (не unit-тестами) нашли и починили два
  независимых бага, подробности в [DECISIONS.md, Decision 026](DECISIONS.md):
  - `store/ops-alerts.ts` — `this.xxx()` внутри методов ломался, когда
    `state-store.ts` торвёт их поодиночке (`GET /api/ops/alerts` падал с
    `500` при любом обращении к Ops-экрану);
  - `deploy/manual-deploy.sh` — сервис `migrate` запускался без `--build`,
    молча работал на старом образе и не видел новые миграции.

Зачем:

- закрывает последний открытый пункт "Что делать" Шага 5 — раньше
  `isActive=false` не говорил, почему нода неактивна (осознанный retire или
  временный сбой), и manual retire мог быть молча отменён здоровым пингом;
- `ops-alerts.ts`-баг был давно существующим, но обнаружен только потому,
  что Ops-экран впервые открыли в реальном браузере против реального
  backend — подтверждение, зачем нужна ручная browser-проверка UI, а не
  только `tsc`/`vitest`.

Проверено: `npm run typecheck`/`test` backend (191/191) и frontend (6/6) —
зелёные; вручную в браузере (retire/reactivate через Ops UI, оба сценария);
задеплоено на боевой VPS, `GET /api/ops/alerts` и `GET
/api/admin/endpoints` отвечают `200` после деплоя.

### Шаг 2a: реальный VLESS+REALITY-туннель поднят и подтверждён вручную; закрыт пробел per-user client id

Что сделали:

- впервые в жизни проекта прогнали `deploy/xray/provision-node.sh register`
  на реальном VPS (57.128.220.83) — поднял настоящий `xray-core` inbound
  (VLESS+REALITY+TCP) и зарегистрировал ноду через Admin API;
- получили реальный `connectionConfig` через `POST /api/routes/resolve` для
  тестового пользователя, синхронизировали его `vlessUuid` в конфиг ноды,
  подняли локальный `xray-core` клиент (SOCKS5), прогнали `curl` через
  туннель — вернулся IP VPS, а не клиента. Первая живая проверка реального
  VPN-транспорта в проекте;
- закрыт пробел "один client id на ноду, а не per-user": новый admin
  эндпоинт `GET /api/admin/vless-clients`
  ([backend/src/server.ts](../backend/src/server.ts),
  `listVlessClients()` в [backend/src/store/endpoints.ts](../backend/src/store/endpoints.ts))
  + [deploy/xray/sync-clients.sh](../deploy/xray/sync-clients.sh) — по cron
  (раз в 5 минут) перекладывает актуальный список `User.vlessUuid` в
  `inbound.settings.clients` и рестартует ноду, только если список реально
  изменился. Проверено вживую вторым тестовым пользователем;
- 2 новых unit-теста на `listVlessClients()` в
  [backend/src/store/__tests__/endpoints.test.ts](../backend/src/store/__tests__/endpoints.test.ts);
- по пути найдены и починены два независимых бага в тестовой обвязке:
  клиентский inbound слушал `127.0.0.1` вместо `0.0.0.0` (Docker
  port-forward до него не достаёт), и `mktemp` под `sudo` создавал файл с
  правами `600 root`, нечитаемый non-root `xray-core` контейнером (UID
  `65532`) после `mv` — `sync-clients.sh` теперь явно делает `chmod 644`;
- прибрались после проверки: 2 из 3 тестовых endpoint'ов, поднятых только
  ради прохождения `inventory-policy.ts` (нужно ≥3 failure domains), нельзя
  было retire'ить — сама policy это заблокировала (все три физически на
  одном VPS, retire уронил бы inventory ниже минимума). Вместо этого
  переименовали все три с явной пометкой `[TEST: co-located on single VPS,
  not real provider diversity]`; тестовый admin-аккаунт понижен до обычного
  пользователя; для cron заведён отдельный сервисный admin-аккаунт
  (`xray-fleet-automation@...`), не тестовый; debug-логи (`loglevel:
  debug`, REALITY `show: true`), включённые для диагностики, возвращены на
  `warning`/`false`.

Зачем:

- закрывает Definition of done Этапа 2a
  [PRIORITY_PLAN.md, Шаг 2](PRIORITY_PLAN.md) — впервые в проекте кнопка
  "Подключить" для VLESS+REALITY подтверждённо означает настоящее VPN-
  соединение, а не переключение поля `status` в БД;
- закрывает известный TODO из Шага 5 ("per-user client id... вынесено в
  Шаг 2") — без него реально подключиться мог только один захардкоженный
  пользователь на ноду.

Что не сделано / известные пробелы (см. подробности в
[DECISIONS.md, Decision 025](DECISIONS.md)):

- inventory сейчас "policy-compliant" только формально — все 3 активных
  endpoint'а на одном физическом VPS, реальной provider/ASN-диверсификации
  нет, пока не появятся ещё 2-3 отдельных VPS у разных провайдеров;
- `sync-clients.sh` рестартует ноду при каждом изменении состава клиентов
  (роняет активные соединения на секунду-две) — сознательно выбранный
  вариант вместо gRPC `HandlerService` (без даунтайма), см. Decision 025;
  станет проблемой при плотном multi-user трафике, не сейчас;
- сервисный аккаунт для cron — обычная `AuthSession` с тем же сроком жизни,
  что у пользовательских сессий (~30 дней), а не отдельный неистекающий
  service-token — такого понятия в модели авторизации пока нет;
- native-обвязка (Этап 2b) по-прежнему не собиралась — нет Android
  SDK/Gradle в текущей dev-среде, см. [mobile/README.md](../mobile/README.md).

Проверено: `npm run typecheck --workspace backend`, `npm run test
--workspace backend` (186/186 — с учётом 2 новых тестов), `npm run test
--workspace frontend` (6/6) — все зелёные. Плюс живая ручная проверка на
реальном VPS (см. выше), не только unit-тесты.

### Шаг 6 (завершение): bridge-модель подключена к маршрутам через pinning — continuity и manualEndpointId решены

Что сделали:

- [backend/src/inventory-segmentation.ts](../backend/src/inventory-segmentation.ts) —
  `selectClientSegment()` получил параметр `pinnedEndpointIds`: любой
  endpointId из этого списка, реально существующий в inventory,
  принудительно входит в сегмент независимо от hash-ранга; итоговый порядок
  элементов сохраняет исходный (pool priority/latency), а не внутренний
  hash-порядок отбора
- `backend/src/types.ts` — новый тип `ServerSegmentationContext` (`{
  subjectId, pinnedEndpointIds }`)
- `backend/src/store/session.ts::listServers()` — принимает необязательный
  `segmentation`, применяет `selectClientSegment()` **после**
  fail-closed policy-проверки на полном inventory (сама проверка
  по-прежнему смотрит на весь парк, не на сегмент)
- `backend/src/runtime.ts::resolveRouteDecision()` — переставлен порядок
  вызовов (`getCurrentAssignment`/`getLastKnownGoodRoute` теперь до
  `listServers()`), передаёт `auth.userId` как `subjectId` и собирает
  `pinnedEndpointIds` из трёх источников: текущего assignment'а, последнего
  известного рабочего маршрута и `manualEndpointId` из тела запроса
- 4 новых unit-теста в
  [backend/src/__tests__/inventory-segmentation.test.ts](../backend/src/__tests__/inventory-segmentation.test.ts)
  (итого 11): pinned endpoint всегда в сегменте даже при "невыгодном"
  hash-ранге, несуществующий pinned id тихо игнорируется, порядок
  сохраняется, passthrough работает и с заданными пинами

Зачем:

- закрывает оба открытых вопроса из [DECISIONS.md, Decision 024](DECISIONS.md):
  что происходит с активным подключением/последним рабочим маршрутом при
  ротации сегмента (ответ: они всегда pinned, не пропадают) и как
  обрабатывать `manualEndpointId` вне сегмента (ответ: тоже pinned,
  сегментация не блокирует explicit-запрос) — оба закрыты одним и тем же
  механизмом вместо двух разных
- завершает Definition of done [PRIORITY_PLAN.md, Шаг 6](PRIORITY_PLAN.md)

Что не сделано / известные пробелы:

- не проверено против реальной Postgres — в dev-среде нет БД;
  `defaults.ts` даёт только 1-2 endpoint'а, что ниже `passthroughThreshold`
  (6), так что на существующих dev-данных сегментация физически не
  активируется, только в unit-тестах на синтетическом парке
- протокольная diversity (Trojan/Shadowsocks-2022) по-прежнему отдельная
  очередь, не в этом шаге

Проверено: `npm run typecheck --workspace backend`, `npm run test
--workspace backend` (183/184, тот же pre-existing time-of-day flaky тест) —
зелёные, включая существующие `session.test.ts`/`route-policy.test.ts` без
изменений в самих тестах.

### Priority Plan расширен Шагами 3-6: client auto-fallback, CI/CD, fleet provisioning, anti-censorship distribution

Что сделали:

- в [PRIORITY_PLAN.md](PRIORITY_PLAN.md) после Шага 2 (реальный транспорт)
  добавлены 4 новых шага: клиентский auto-fallback по shortlist, CI/CD
  deploy pipeline, fleet provisioning для Xray-нод, устойчивость к блокировке
  оператора (SNI-diversity + bridge-модель распространения inventory)
- старый Шаг 3 (alerting) перенумерован в Шаг 7, продолжает ждать закрытия
  всего, что перед ним
- Шаг 1 (OTP-утечка) помечен как сделанный со ссылкой на существующие
  Decision 020/022
- обоснование порядка зафиксировано как [DECISIONS.md, Decision 023](DECISIONS.md)

Зачем:

- пользователь запросил свести в план вопросы про CI/CD, admin-дашборд,
  автоматический вывод ноды из ротации и устойчивость к блокировке
  оператора, поднятые в обсуждении текущего состояния backend/frontend
- часть механизмов уже частично реализована (TCP healthcheck worker гасит
  `isActive`, `route-policy.ts` уже строит diversified shortlist) — новые
  шаги достраивают недостающую часть, а не изобретают всё заново

### Шаг 3: client-side auto-fallback executor по routePolicy.shortlist

Что сделали:

- новый [frontend/src/lib/connectFallback.ts](../frontend/src/lib/connectFallback.ts) —
  `connectWithFallback()`: чистая функция, идёт по `routePolicy.shortlist` по
  порядку (кандидат №1 переиспользует уже полученный `connectionConfig`,
  остальные — через `POST /api/routes/resolve` с `manualEndpointId`), на
  каждой попытке таймаут 7 сек (`withTimeout`), на каждый провал шлёт
  `POST /api/routes/feedback` (`source: "connect"`) до перехода к следующему
  кандидату, останавливается на первом успехе или после `maxAttempts` (4)
  — 6 unit-тестов в
  [frontend/src/lib/__tests__/connectFallback.test.ts](../frontend/src/lib/__tests__/connectFallback.test.ts)
- [frontend/src/hooks/useRouteSession.ts](../frontend/src/hooks/useRouteSession.ts) —
  `toggleConnection()` вызывает executor только когда
  `isNativeTunnelAvailable()` (в browser-only PWA поведение не меняется —
  как и раньше, `applyNativeTunnel` no-op); если fallback выбрал не
  recommended-кандидата, вызывает `POST /api/server` с явным
  `assignmentReason`, чтобы официально подтвердить переключение
- backend: `POST /api/server` ([backend/src/server.ts](../backend/src/server.ts))
  теперь принимает опциональный `assignmentReason`, ограниченный allowlist'ом
  non-manual reason'ов из `route-policy.ts` shortlist
  (`last_known_good`/`network_ranking_primary`/`baseline_pool_priority`/
  `route_health_adjusted_primary`/`transport_diagnostic_fallback`/
  `provider_diversity_fallback`/`asn_diversity_fallback`/`emergency_fallback`);
  без этого поля поведение как раньше — дефолт `manual_select`
- `frontend/package.json` — добавлен `vitest` (та же версия, что у backend) и
  скрипты `test`/`test:watch`; `.github/workflows/ci.yml` — новый шаг "Run
  frontend tests"

Зачем:

- `docs/NETWORK_INTELLIGENCE.md, раздел 2` описывает recovery order на
  клиенте, backend уже строил нужный shortlist
  ([backend/src/route-policy.ts](../backend/src/route-policy.ts)), но клиент
  раньше брал только кандидата №1 и не перебирал остальных при провале —
  [PRIORITY_PLAN.md, Шаг 3](PRIORITY_PLAN.md)
- если бы auto-picked кандидат записывался как `manual_select`, следующий
  вызов `route-policy.ts` намертво прикалывал бы его через `manualOverride`,
  игнорируя дальнейшую health-деградацию — это неверная семантика для
  автоматического fallback'а, отсюда отдельный allowlist reason'ов на
  `/api/server`

Что не сделано:

- реальная проверка на устройстве (провал primary → успешный fallback)
  заблокирована Шагом 2 — нет ни настоящего Xray inbound на большинстве
  endpoint'ов, ни собранного Android-шелла

### Шаг 4: Dockerfile'ы, deploy-job'ы в CI, compose для целевого сервера (код без сборки — нет Docker в dev-среде)

Что сделали:

- [backend/Dockerfile](../backend/Dockerfile) — multi-stage (`build` со всеми
  devDependencies -> `prod-deps` с `npm ci --omit=dev` -> `runtime` alpine),
  тот же образ для API (`node backend/dist/server.js`) и route-reprobe worker
  (`node backend/dist/worker.js`, CMD переопределяется при запуске)
- [frontend/Dockerfile](../frontend/Dockerfile) — `vite build` -> nginx,
  [deploy/nginx/frontend.conf](../deploy/nginx/frontend.conf) реверс-проксирует
  `/api` и `/health` на `backend:8080`, тот же контракт, что у dev-proxy в
  `frontend/vite.config.ts`
- `compose.yaml` — новый profile `prod` (`docker compose --profile prod up --build`)
  для локального smoke-теста образов без push в registry; существующий
  dev-flow (`npm run dev`) не тронут
- [deploy/compose.prod.yaml](../deploy/compose.prod.yaml) — compose для
  самого сервера: только тянет `${BACKEND_IMAGE}`/`${FRONTEND_IMAGE}` из
  GHCR, ничего не собирает; Postgres сюда сознательно не включён (managed БД
  или отдельный инстанс, адрес через `DATABASE_URL` в `.env` на сервере)
- `.github/workflows/ci.yml` — новые job'ы `deploy-staging` (push в `main`
  после зелёного `quality`) и `deploy-prod` (тег `vX.Y.Z`, `environment: prod`
  для ручного approve через required reviewers): build+push образов в GHCR,
  `prisma migrate deploy` на целевую БД, деплой на VPS через SSH
  (`docker compose -f deploy/compose.prod.yaml pull && up -d`)
- [deploy/README.md](../deploy/README.md) — какие GitHub secrets/environments
  нужно завести, чтобы job'ы реально заработали, и что сделать руками на VPS
  один раз перед первым деплоем

Зачем:

- [PRIORITY_PLAN.md, Шаг 4](PRIORITY_PLAN.md) — до этого CI только проверял
  (lint/typecheck/tests/build), никуда ничего не катил; не было ни одного
  Dockerfile

Что не сделано / известные пробелы:

- ничего не собиралось и не запускалось — в dev-среде этой сессии нет Docker
- ни одного secret/environment в GitHub ещё не заведено — job'ы `deploy-*`
  неактивны, пока Николай не настроит их по `deploy/README.md`
- нет health-check/rollback шага после `docker compose up -d`
- `npm ci --omit=dev` ставит prod-зависимости для всех workspace'ов разом
  (общий lockfile) — образ backend тащит и frontend-зависимости

### Шаг 5: Admin API + Ops UI + provision-скрипт для Xray-нод

Что сделали:

- `backend/src/types.ts` — `AdminEndpointSummary`,
  `RegisterAdminEndpointBody`, `SetAdminEndpointActiveBody` и связанные типы
- [backend/src/store/endpoints.ts](../backend/src/store/endpoints.ts) —
  `listAdminEndpoints`/`registerEndpoint`/`setEndpointActive`, плюс чистая
  `evaluateEndpointRetirement()` — не даёт вручную выключить endpoint, если
  это уронит active-inventory ниже минимума
  `inventory-policy.ts` (`≥3` failure domains); 3 unit-теста
  ([backend/src/store/__tests__/endpoints.test.ts](../backend/src/store/__tests__/endpoints.test.ts))
- `backend/src/server.ts` — новые роуты `GET/POST /api/admin/endpoints`,
  `PATCH /api/admin/endpoints/:endpointId`, все за
  `requireAdminAuthSession`
- `frontend/src/hooks/useAdminEndpoints.ts`,
  [frontend/src/components/OpsScreen.tsx](../frontend/src/components/OpsScreen.tsx) —
  секция "Fleet — Xray-ноды" в существующем Ops-экране (не отдельный
  dashboard): список нод, кнопки Retire/Reactivate прямо рядом с
  alert-действиями
- [deploy/xray/provision-node.sh](../deploy/xray/provision-node.sh) —
  bash-скрипт `register`/`retire`/`reactivate`: генерирует x25519 keypair
  через `xray-core x25519` в Docker, берёт случайный `sni`/`fingerprint` из
  стартового пула (4 домена / 3 fingerprint'а), пишет Xray inbound config,
  поднимает контейнер, регистрирует ноду через новый Admin API

Зачем:

- [PRIORITY_PLAN.md, Шаг 5](PRIORITY_PLAN.md) — не было ни процедуры
  добавить ноду без правки `defaults.ts`, ни ручного вывода из ротации
  (только автоматический soft-detect через healthcheck worker)

Что не сделано / известные пробелы:

- скрипт не запускался — нет Docker и реального VPS в dev-среде этой
  сессии, проверен только `bash -n`
- обнаружен нерешённый design-вопрос: `connection-config.ts` выдаёт
  каждому пользователю персональный `vlessUuid`, а Xray inbound (и в
  `dev-config.json`, и в новом скрипте) держит один client-id — реальная
  multi-user нода так работать не будет. Осознанно вынесено в Шаг 2, не
  решалось в рамках Шага 5 (это про то, как нода обслуживает
  пользователей, а не про fleet-provisioning)
- automatic-retire по длительности `consecutiveHealthFailures` не
  реализован, только ручной retire из Ops
- Ansible/cloud-init обвязки нет, только bash-скрипт для уже поднятого
  VPS с Docker

Проверено: `npm run typecheck --workspace backend`,
`npm run typecheck --workspace frontend`, `npm run test --workspace backend`
(172/173, один pre-existing flaky тест на time-of-day не связан с этим
Шагом), `npm run test --workspace frontend` (6/6) — зелёные.

### Шаг 6 (частично): bridge-модель спроектирована и реализована как чистая функция, SNI/fingerprint diversity закрыт

Что сделали:

- SNI/fingerprint diversity — уже закрыт побочным эффектом Шага 5:
  `provision-node.sh` берёт случайный `sni`/`fingerprint` из пула на каждую
  ноду вместо одного захардкоженного домена на весь парк
- [DECISIONS.md, Decision 024](DECISIONS.md) — спроектирована bridge-модель:
  детерминированный per-user segment по
  `sha256(userId:rotationBucket:endpointId)`, сам сегмент обязан быть
  policy-compliant (переиспользует `inventory-policy.ts`), passthrough для
  маленького парка, fail-open к полному списку, если policy-совместимое
  подмножество меньше полного набрать не удалось
- [backend/src/inventory-segmentation.ts](../backend/src/inventory-segmentation.ts) —
  `selectClientSegment()`, чистая функция без Prisma/побочных эффектов
- [backend/src/__tests__/inventory-segmentation.test.ts](../backend/src/__tests__/inventory-segmentation.test.ts) —
  7 тестов: passthrough для маленького парка, строгое подмножество для
  большого, policy-совместимость результата, детерминизм в пределах
  rotation bucket, разные пользователи — разные сегменты, ротация сегмента
  со сменой bucket, fallback на полный список для вырожденного (однородного)
  парка

Зачем:

- [PRIORITY_PLAN.md, Шаг 6](PRIORITY_PLAN.md) и сам Decision 023 требуют
  зафиксировать Decision до реализации, т.к. это меняет модель доступа к
  data-plane (затрагивает Decision 022) — сначала спроектировали и
  задокументировали, потом написали код

Что не сделано / известные пробелы:

- `selectClientSegment()` **не подключена** к
  `session.ts::listServers()`/`runtime.ts::resolveRouteDecision()` —
  подключение осознанно отложено до решения двух continuity-вопросов,
  описанных в Decision 024 (что происходит с активным `currentAssignment`
  вне нового сегмента после ротации; как `manualEndpointId` в
  `/api/routes/resolve` обрабатывает endpoint вне сегмента запросившего).
  Продукт сегодня по-прежнему отдаёт полный inventory всем клиентам
- протокольная diversity (Trojan/Shadowsocks-2022 fallback) — не в этом
  заходе, отдельная очередь по ROADMAP.md, Этап 6

Проверено: `npm run typecheck --workspace backend`, `npm run test
--workspace backend` (179/180, тот же pre-existing flaky тест) — зелёные.

## 2026-07-08

### Этап 2b: JS-сторона native tunnel plugin подключена к connect-flow; Kotlin-скелет доработан (код без сборки)

Что сделали:

- окружение сессии не имеет Android SDK/Gradle (`adb`/`sdkmanager`/`gradle`
  отсутствуют) и Docker-демон не запущен — реальную сборку/проверку `android/`
  и live SOCKS-туннель через REALITY в этой среде продолжить нельзя; по
  явному выбору продолжили писать код Этапа 2b без сборки
- добавили `@capacitor/core` в зависимости `frontend/` (безопасно в браузере:
  `Capacitor.isNativePlatform()` возвращает `false` вне нативной оболочки)
- новый [frontend/src/lib/vpnTunnel.ts](../frontend/src/lib/vpnTunnel.ts) —
  `registerPlugin<VpnTunnelPlugin>("VpnTunnel")` и best-effort
  `connectNativeTunnel`/`disconnectNativeTunnel`, которые в браузере всегда
  no-op, а в native-оболочке не бросают исключение в основной flow при ошибке
- [frontend/src/hooks/useRouteSession.ts](../frontend/src/hooks/useRouteSession.ts) —
  `toggleConnection()` и `changeServer()` теперь вызывают нативный туннель
  сразу после получения `connectionConfig` от backend; `session.status`
  остаётся источником истины (Decision 021), нативная ошибка идёт в `onError`
  отдельным сообщением, не блокируя control-plane flow
- убрали дублирующий `mobile/src/plugins/vpn-tunnel.ts` — JS-плагин живёт
  только во `frontend/`, потому что именно `frontend/dist` Capacitor
  бандлит как `webDir` ([mobile/capacitor.config.ts](../mobile/capacitor.config.ts))
- [mobile/android-skeleton/VpnTunnelPlugin.kt](../mobile/android-skeleton/VpnTunnelPlugin.kt) —
  `connect()` теперь парсит `config.params` и валидирует обязательные поля,
  корректно реализует `VpnService.prepare()` consent-flow через Capacitor
  `startActivityForResult`/`@ActivityCallback`; вызов Xray core внутри
  `startTunnel()` остался `TODO` — выбор конкретной mobile-библиотеки Xray
  core сознательно не сделан здесь
- обновили [mobile/README.md](../mobile/README.md) и
  [PRIORITY_PLAN.md, Этап 2b](PRIORITY_PLAN.md) явным статусом: что сделано
  без сборки, что заблокировано средой, что нужно сделать первым делом при
  появлении Android-тулинга (начать со сборки `android/`, чтобы проверить
  Kotlin-скелет, который пока не компилировался)

Зачем:

- [PRIORITY_PLAN.md, Шаг 2, Этап 2b, п.2](PRIORITY_PLAN.md) требует, чтобы
  кнопка "Подключить" реально запускала туннель на устройстве — без Android
  SDK нельзя закрыть это целиком, но JS-сторону интеграции (п.5 из
  `mobile/README.md`) можно было сделать и проверить typecheck'ом уже сейчас,
  не дожидаясь тулинга
- честно зафиксировать, что осталось непроверенным (весь Kotlin-код,
  реальный Xray core), а не выдавать черновик за готовую реализацию

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
