# Priority Plan: OTP-утечка → реальный транспорт → устойчивость подключения → инфраструктура → alerting

Этот документ фиксирует порядок работ, который временно переопределяет
"что делаем дальше" из [ROADMAP.md](ROADMAP.md): пока не закрыты Шаги 1-6
ниже, новые фичи в ops/alerting-слое ([ROADMAP.md, Этап 6](ROADMAP.md)) не берём.

Шаги 3-6 добавлены `2026-07-09` — обоснование порядка см.
[DECISIONS.md, Decision 023](DECISIONS.md).

## Почему такой порядок

- продукт обещает пользователю реальное VPN-подключение ([PRODUCT.md](PRODUCT.md):
  "нажал `Подключить` — клиент сам нашел рабочий маршрут"), но сейчас
  `/api/connect` только переключает статус в БД — реального транспорта нет;
- при этом ops/alerting-слой (persisted alerts, escalation, delivery,
  digest/cooldown policy) уже развит намного дальше, чем ядро продукта;
- verification-flow (email/Telegram OTP) сейчас отдаёт код прямо в ответе
  API — это открытая дыра для account takeover, и её нужно закрыть раньше
  любой другой работы, потому что она сегодня активно эксплуатируема.

## Шаг 1 — Закрыть OTP-утечку (P0, блокер)

**Статус: сделано** ([DECISIONS.md, Decision 020](DECISIONS.md),
[Decision 022](DECISIONS.md)) — код больше не покидает backend в HTTP-ответе,
доставка идёт через `message-transport.ts`, data-plane закрыт авторизацией.

### Проблема

- `store.requestAuthChallenge()` возвращает объект `challenge`, включающий
  plaintext `code`, наружу как есть —
  [backend/src/store/auth.ts:262-268](../backend/src/store/auth.ts#L262-L268).
- HTTP-хендлер пробрасывает это в ответ клиенту без изменений —
  [backend/src/server.ts:311-318](../backend/src/server.ts#L311-L318).
- Итог: `POST /api/auth/challenge` возвращает одноразовый код прямо в
  HTTP-ответе — email/Telegram верификация ничего не проверяет, потому что
  код не нужно получать из письма/бота, он уже есть в ответе на запрос
  challenge.

### Что делать

1. В `backend/src/store/auth.ts` — `requestAuthChallenge()` должен
   возвращать наружу только `{ challengeId, provider, target, expiresAt }`,
   без `code`. Сам `code` остаётся только внутри функции для передачи в
   транспорт доставки.
2. Завести доставку кода через транспорт-адаптер. Сейчас в проекте уже есть
   рабочий Resend/Telegram Bot API транспорт для ops-алертов —
   [backend/src/store/ops-alert-delivery.ts](../backend/src/store/ops-alert-delivery.ts).
   Не изобретать новый — вынести общую часть (`deliverViaResend`,
   `deliverViaTelegramBot`, env-конфиг) в переиспользуемый модуль
   (например `backend/src/transport/message-transport.ts`) и использовать
   его и для ops-alerts, и для auth-verification.
3. Dev-fallback: если transport не сконфигурирован (нет
   `RESEND_API_KEY`/`OPS_ALERT_TELEGRAM_BOT_TOKEN` в `.env`) — код пишем
   только в server log (`app.log.info`), а не отдаём клиенту.
4. Обновить `backend/src/server.ts` handler `/api/auth/challenge`, чтобы
   он не завязывался на прежнюю форму ответа с `code`.
5. Тесты: явный unit/integration тест, что тело ответа `/api/auth/challenge`
   и объект, возвращаемый `requestAuthChallenge()`, никогда не содержат
   `code`/`codeHash`; тест, что transport вызывается с правильным
   `target`/`message`.
6. Зафиксировать фикс отдельной записью в [DECISIONS.md](DECISIONS.md) и
   [CHANGELOG.md](CHANGELOG.md) — по текущему формату проекта.

### Definition of done

- ни один HTTP-ответ и ни один объект стора не содержит plaintext OTP;
- код реально уходит через email/Telegram transport, а не в API response;
- есть тест, который ловит регресс, если код случайно снова попадёт в ответ.

## Шаг 2 — Реальный транспорт: VLESS + REALITY через Xray (P0, продуктовый блокер)

### Архитектурная реальность, которую нужно явно признать

Браузерная PWA не может открыть сырой TCP-сокет или поднять TUN-интерфейс —
у веб-платформы просто нет low-level network API для этого. Это значит, что
"PWA-first" в применении к самому VPN-туннелю физически не работает: PWA
может быть только UI/control-plane (выбор сервера, статус, аккаунт), а
реальный туннель должен либо жить в native-обвязке на устройстве, либо
проверяться отдельным reference-клиентом на этапе сервера. Это стоит
зафиксировать отдельным Decision в [DECISIONS.md](DECISIONS.md) до начала
работы — иначе последовательность "сначала хороший PWA UX, потом
упаковка" из [ROADMAP.md, Этап 4](ROADMAP.md) будет незаметно противоречить
самому обещанию продукта.

### Этап 2a. Сервер — Xray inbound + выдача конфига (можно начинать сразу)

**Статус (2026-07-09): сделано и подтверждено вручную на реальном VPS.**
Подробности — [DECISIONS.md, Decision 025](DECISIONS.md),
[CHANGELOG.md](CHANGELOG.md). Коротко:

- реальный `xray-core` inbound (VLESS+REALITY+TCP) поднят на боевом VPS
  через [deploy/xray/provision-node.sh](../deploy/xray/provision-node.sh)
  (впервые в жизни этого скрипта);
- backend выдаёт настоящий `connectionConfig` через `POST
  /api/routes/resolve`/`/api/connect`/`/api/server` —
  [backend/src/connection-config.ts](../backend/src/connection-config.ts),
  [backend/src/store/connection-config.ts](../backend/src/store/connection-config.ts)
  (этот код был готов раньше проверки, но не был прогнан вживую до сих пор);
- **пробел "per-user client id" закрыт**: `GET /api/admin/vless-clients`
  (новый эндпоинт, [backend/src/store/endpoints.ts](../backend/src/store/endpoints.ts)
  `listVlessClients()`) + [deploy/xray/sync-clients.sh](../deploy/xray/sync-clients.sh)
  (cron на самой ноде, раз в 5 минут) перекладывают актуальный список
  `User.vlessUuid` в `inbound.settings.clients` и рестартуют ноду только при
  реальном изменении списка. Компромисс: рестарт роняет активные соединения
  на этой ноде на секунду-две при каждом изменении — сознательно выбран
  вместо gRPC `HandlerService` (без даунтайма), см. Decision 025;
- вручную подтверждено: `curl` через SOCKS5-туннель, поднятый локальным
  `xray-core` клиентом с выданным backend'ом конфигом, вернул IP VPS, а не
  клиента — п.5 ниже пройден по-настоящему, не только юнит-тестами.

**Известный оставшийся пробел (частично закрыт 2026-07-09):** чтобы пройти
`inventory-policy.ts` (≥3 независимых failure domains), на первом VPS были
зарегистрированы 3 Xray-инбаунда — но физически это **один и тот же хост**
(`57.128.220.83`, реально OVH, `AS16276` — подтверждено whois/`ipinfo.io`).
Только один из трёх лейблов на этом хосте честный (`France Test Node` —
провайдер и правда OVH); два других (`Germany Test Node` → Hetzner, `AS24940`;
`Netherlands Test Node` → DigitalOcean, `AS14061`) — фейковые ярлыки на том же
самом OVH-хосте, промаркированы `[TEST: co-located on single VPS, ...]` в
label. Retire лишних узлов заблокирован самой policy (см. Decision 025).
Подключён второй, физически отдельный VPS (Contabo, `AS51167`, Франция) — см.
[DECISIONS.md, Decision 030](DECISIONS.md): реальный `xray-core` inbound
поднят через `provision-node.sh`, IP-ротация между этим узлом и первым VPS
подтверждена вживую (`curl` через SOCKS5 вернул `167.86.77.100`, затем после
симуляции отказа — `57.128.220.83`). Сейчас 2 из 4 endpoint'ов — реально
разные хосты у разных провайдеров (OVH и Contabo), 2 остальных — fake-лейблы
(Hetzner, DigitalOcean) на том же OVH-хосте.

**Обновление (2026-07-10): пробел закрыт полностью, вживую, понижением
порога вместо третьего VPS** — бюджет на третьего провайдера сейчас
ограничен. См. [Decision 047](DECISIONS.md): `MINIMUM_INDEPENDENT_FAILURE_DOMAINS`
в `inventory-policy.ts` снижен `3` → `2`, задеплоено на оба боевых хоста
через `manual-deploy.sh` (`200`/`401` подтверждены на обоих после деплоя).
Обе fake-ноды (`Germany Test Node`, `Netherlands Test Node`) не просто
retired, а физически удалены из `Endpoint` через прямой `DELETE` в psql —
это были тестовые записи без реального сервера позади. Живой инвентарь
теперь — ровно 2 честные записи: `France OVH Node` (лейбл переименован,
устаревший хвост `[TEST: co-located...]` убран) и `Contabo France Real
Node`. `inventory-policy.ts` теперь честно проходится на 2 реальных
провайдерах (OVH, Contabo) без единой фейковой записи в базе. Trade-off:
отказоустойчивость ниже изначальной цели — потеря одного провайдера теперь
означает потерю половины failure domains, а не трети. Когда бюджет позволит
третий VPS, стоит вернуть порог к `3`.

1. Поднять реальный процесс `Xray-core` (сервис в `compose.yaml`, рядом с
   backend) с одним настоящим inbound `VLESS + REALITY + TCP` — как primary
   путь по [ROADMAP.md, Этап 6](ROADMAP.md).
   В `backend/src/defaults.ts` уже есть заготовка под это: endpoint
   `de-fra-1` с `protocol: "vless"` и `transportProfile: "reality-tcp"`, но
   его `ipAddress: "203.0.113.10"` — документационный (RFC 5737), нерабочий
   адрес. Для первого реального узла нужен либо настоящий dev-VPS/докер-хост,
   либо явно помеченный локальный dev-inbound.
2. Расширить Prisma schema (`backend/prisma/schema.prisma`): у `Endpoint`
   сейчас есть только `protocol`/`transportProfile` как строки
   ([backend/prisma/schema.prisma:83-108](../backend/prisma/schema.prisma#L83-L108)),
   но нет ни одного реального transport-параметра. Нужны поля под
   REALITY-конфиг: порт, `publicKey`, `shortId`, `sni`, per-user `uuid` —
   либо на самом `Endpoint`, либо в отдельной таблице
   `EndpointTransportConfig`.
3. Добавить в backend функцию "issue client config": на основе результата
   уже существующего `route-policy` ([backend/src/route-policy.ts](../backend/src/route-policy.ts))
   строить настоящий VLESS+REALITY connection URI/JSON, а не только
   `recommendedReason`/метаданные, как сейчас.
4. Встроить выдачу конфига в уже существующие `POST /api/routes/resolve` и
   `POST /api/connect` — добавить новое поле `connectionConfig` в ответ, не
   ломая текущий контракт (`session`/`routePolicy` остаются как есть).
5. Проверка вручную: подключиться к этому inbound существующим
   reference-клиентом (`xray-core` CLI, v2rayN, NekoBox) с выданным
   backend'ом конфигом, убедиться, что исходящий IP реально меняется. Это
   первый момент в проекте, когда "VPN" в коде реально означает VPN.
6. Тесты: unit на построение connection URI/конфига (корректность
   `uuid`/`publicKey`/`shortId`); при возможности — скриптовый smoke-test
   (поднять `xray-core` в dev-докере, получить конфиг у backend, пройти
   через локальный SOCKS-прокси, проверить реальную доступность интернета).

### Этап 2b. Минимальная нативная обвязка — раньше срока из ROADMAP Этап 4

1. Поднять Capacitor Android shell раньше, чем сейчас стоит в очереди
   ([ROADMAP.md, Этап 4](ROADMAP.md) идёт после Этапов 5-9) — но по
   минимуму: ровно настолько, чтобы встроить mobile-сборку Xray core и
   Android `VpnService`.
2. Кнопка "Подключить" на реальном устройстве должна: получить
   `connectionConfig` у backend → запустить локальный Xray core → поднять
   туннель через `VpnService`.
3. Проверка вручную на реальном устройстве: публичный IP меняется, трафик
   реально идёт через туннель.

**Статус (2026-07-09): Android-тулинг установлен, `npx cap add android`
выполнен, `VpnTunnelPlugin.kt` реально скомпилирован, debug APK собран.**
См. [Decision 028](DECISIONS.md). Раньше (2026-07-08) здесь считалось, что
окружение для сборки физически недоступно — это больше не так на этой
машине. Сделано:

- Gradle, Android SDK (cmdline-tools, platform-tools, `android-34`/`35`,
  `build-tools 35.0.0`), JDK 21 — установлены через Homebrew;
- `cd mobile && npm install && npx cap add android` — реальный Gradle-проект
  `mobile/android/` сгенерирован;
- `android-skeleton/VpnTunnelPlugin.kt` скопирован в
  `android/app/src/main/java/com/simpledimple/app/VpnTunnelPlugin.kt` и
  зарегистрирован в `MainActivity.java`;
- Kotlin подключён в Gradle-конфиг (не было по умолчанию после `cap add
  android`);
- `./gradlew :app:assembleDebug` → `BUILD SUCCESSFUL`, `app-debug.apk`
  реально существует на диске (~4.16MB).

**Обновление того же дня:** `startTunnel()`/`SimpleDimpleVpnService`
реализованы поверх `XTLS/libXray` (см. [Decision 029](DECISIONS.md)) —
больше не `TODO`. `./gradlew :app:assembleDebug` → `BUILD SUCCESSFUL` с
реально влинкованным `libgojni.so` (скомпилированный Xray-core) во всех 4
ABI итогового APK. Архитектура оказалась проще ожидаемой: у Xray-core есть
встроенный `tun` inbound (gVisor userspace stack), отдельный tun2socks-мост
не понадобился.

**Обновление 2026-07-09 (вечер): живая проверка на эмуляторе проведена,
частично успешна.** См. [Decision 035](DECISIONS.md). Поднят реальный
Android-эмулятор (AVD, `android-34`/`google_apis`/`arm64-v8a`), установлен
и запущен уже собранный `app-debug.apk`. Подтверждено вживую:
- реальный вход/регистрация в приложении против живого backend на VPS1;
- нажатие "Подключить" реально доходит до `VpnService.prepare()` — появился
  настоящий системный диалог Android `Connection request`, не мок;
- после согласия реально поднялся `tun`-интерфейс с параметрами из
  `SimpleDimpleVpnService` (`10.10.14.1/30`), foreground-сервис стартовал,
  Xray-core на устройстве реально дозвонился до порта Contabo-ноды
  (`accepted tcp:167.86.77.100:8446` в logcat).

Отдельно найденный реальный баг гонки — `SimpleDimpleVpnService` не
останавливал предыдущий Xray-core/tun перед стартом нового при
последовательных попытках `connectWithFallback` (Шаг 3), получались
параллельные `tun`-интерфейсы с одинаковым IP — **исправлен**, см.
[Decision 036](DECISIONS.md).

**Обновление 2026-07-10: живая проверка на реальном физическом Android-
устройстве проведена, сквозная доставка трафика подтверждена.** См.
[Decision 045](DECISIONS.md). Вопрос "ограничение ли это эмулятора или
реальный баг" из предыдущего обновления — закрыт: это был реальный баг,
не ограничение эмулятора. Найдены и исправлены три независимых проблемы,
ни одна не была видна на эмуляторе или в юнит-тестах:

1. фронтенд не знал абсолютного API URL для native-платформы (все запросы
   шли по относительному пути, в WebView резолвился в `index.html`
   вместо JSON) — добавлена `resolveApiUrl()`;
2. TLS: root CA control-plane (`tls internal`, Decision 040) вшит в APK
   через `network_security_config.xml`, чтобы Android доверял
   self-signed сертификату без ручной установки на устройстве;
3. **главный баг** — `SimpleDimpleVpnService` не регистрировал
   `libXray.DialerController`/`protect(fd)`, из-за чего исходящие
   соединения самого Xray-core перехватывались собственным
   `tun`-интерфейсом (self-loop) — это и объясняет провал сквозного
   трафика на эмуляторе в Decision 035.

Отдельно (не баг кода, а эксплуатационный пробел): `deploy/xray/sync-clients.sh`
не был живым cron'ом ни на одной из 4 нод (на Contabo не установлен вообще,
на OVH дёргал порт, закрытый ещё в Decision 041) — новые пользователи не
попадали в `inbound.settings.clients`. Cron переставлен на обоих VPS.

Ниже — исходный статус до этих обновлений, для истории:

- `mobile/capacitor.config.ts`, `mobile/package.json` — Capacitor-проект
  (не в workspaces, не участвует в build/check backend+frontend)
- `mobile/android-skeleton/VpnTunnelPlugin.kt` — Kotlin-скелет плагина:
  парсинг `config.params`, корректный `VpnService.prepare()` consent-flow
  через Capacitor `startActivityForResult`/`@ActivityCallback`; сам вызов
  Xray core (`startTunnel()`) и `SimpleDimpleVpnService` — TODO, ждут выбора
  конкретной mobile-библиотеки Xray core; код не компилировался (нет
  Kotlin/Gradle-тулинга в этой среде), нужна первая же сборка `android/`
  для проверки
- п.2 со стороны JS уже сделан: `frontend/src/lib/vpnTunnel.ts`
  (`registerPlugin("VpnTunnel")`, `Capacitor.isNativePlatform()`-guard) +
  `frontend/src/hooks/useRouteSession.ts` (`toggleConnection`/`changeServer`
  вызывают `connectNativeTunnel`/`disconnectNativeTunnel` при получении
  `connectionConfig`). JS-плагин живёт в `frontend/`, а не в `mobile/`, —
  Capacitor бандлит `frontend/dist` как `webDir`
- в browser-only PWA это всегда no-op (`isNativePlatform()` → `false`),
  существующий connect-flow не затронут — подтверждено frontend `typecheck`

### Definition of done для Шага 2

- ✅ есть минимум один живой сервер с рабочим VLESS+REALITY inbound
  (Этап 2a, 2026-07-09 — но физически один хост, см. известный пробел выше);
- ✅ backend реально выдаёт рабочий connection-конфиг, а не только метаданные
  решения (Этап 2a);
- ✅ есть минимальный native-клиент, который реально поднимает VPN-туннель
  на устройстве — подтверждено живой проверкой на реальном физическом
  Android-устройстве (2026-07-10, [Decision 045](DECISIONS.md)): APK
  ставится, кнопка "Подключить" реально доходит до `VpnService.prepare()`,
  `tun`-интерфейс поднимается, Xray-core дозванивается до реальной ноды;
- ✅ кнопка "Подключить" хотя бы для одного протокола означает настоящее
  VPN-соединение (публичный IP меняется, трафик реально идёт через
  туннель) — подтверждено и на dev-машине через reference-клиент
  ([Decision 025](DECISIONS.md), [Decision 030](DECISIONS.md)), и через
  нативную Android-обвязку на реальном устройстве ([Decision
  045](DECISIONS.md)) — вопрос "ограничение эмулятора или реальный баг" из
  Decision 035 закрыт: реальный баг (`protect()` не был подключён),
  исправлен;
- ✅ (найдено и исправлено, [Decision 036](DECISIONS.md)) `SimpleDimpleVpnService`
  теперь останавливает предыдущий Xray-core/tun перед стартом нового при
  повторных попытках подключения — сборка подтверждена (`app-debug.apk`
  собран и компилируется чисто, см. [Decision 037](DECISIONS.md)), живой
  ретест на устройстве пройден 2026-07-10.

Definition of done для Шага 2 закрыт полностью.

## Шаг 3 — Клиент сам перебирает shortlist при неудачном подключении (P1)

**Статус (2026-07-10): закрыто полностью, включая прогон через настоящую
native-кнопку на реальном устройстве — см. [Decision 045](DECISIONS.md).**
Executor и тесты (п.1-5 ниже) реализованы:
[frontend/src/lib/connectFallback.ts](../frontend/src/lib/connectFallback.ts),
[frontend/src/lib/__tests__/connectFallback.test.ts](../frontend/src/lib/__tests__/connectFallback.test.ts),
подключён в
[frontend/src/hooks/useRouteSession.ts](../frontend/src/hooks/useRouteSession.ts).
Backend `POST /api/server` дополнительно принимает опциональный
`assignmentReason` (allowlist non-manual reason'ов из shortlist), чтобы
auto-picked кандидат не записывался как `manual_select` — иначе
`route-policy.ts` намертво прикалывал бы его как `manualOverride`.

**Живая проверка (2026-07-09), см. [DECISIONS.md, Decision
031](DECISIONS.md):** после появления второго реального VPS (Contabo, см.
Decision 030) `connectWithFallback()` из `connectFallback.ts` вызван напрямую
(не мок) с реальными `deps` — `fetchCandidateConfig`/`reportFailure` бьют в
настоящий `http://57.128.220.83:8080`, `attemptTunnel` реально поднимает
локальный `xray-core`-клиент и проверяет исходящий IP через `curl`. Primary
(Contabo-нода) остановлен через `docker stop` на живом VPS, чтобы вызвать
настоящий, не подставной провал попытки — executor поймал отказ, отправил
`POST /api/routes/feedback` (`connect_refused`), перешёл к кандидату №2 (OVH,
`57.128.220.83`) и получил реальный туннель (`curl` вернул `57.128.220.83`).
`GET /api/session` после теста показал `routeHealth` с настоящим
`penaltyScore`/`dominantFailureReason: connect_refused` для Contabo-ноды —
feedback реально долетел и был учтён backend'ом, а не потерялся.
**Не покрыто этой проверкой** — сам `connectNativeTunnel`/Capacitor-плагин
(`isNativeTunnelAvailable()` gate в `useRouteSession.ts`) не участвовал:
тест дергал `connectWithFallback` напрямую с собственным `attemptTunnel`,
а не через реальную кнопку "Подключить" на Android-устройстве — это
по-прежнему упирается в незакрытый Шаг 2b (нет живой проверки на
устройстве/эмуляторе).

`npm run test --workspace frontend` (6/6) и
`npm run test --workspace backend` (170/170) — зелёные.

### Проблема

`docs/NETWORK_INTELLIGENCE.md, раздел 2` описывает recovery order на клиенте
(`last_known_good` → другой transport на том же IP → другой IP в пуле →
другой provider/ASN → сохранить победителя → отправить probe result), и
backend уже строит ровно такой shortlist в
[backend/src/route-policy.ts](../backend/src/route-policy.ts). Но
`frontend/src/hooks/useRouteSession.ts` берёт из него только кандидата №1
(`routePolicy.recommendedEndpointId`) и один раз вызывает
`connectNativeTunnel`. Если реальная попытка на устройстве проваливается,
автоматического перехода на кандидата №2 нет — нужен ручной поход на экран
`Server`.

### Что делать

1. В `useRouteSession.ts` завести executor, который идёт по
   `routePolicy.shortlist` по порядку (не только по recommended) с таймаутом
   на попытку (~6-8 сек) и капом по числу попыток.
2. При провале попытки — сразу `POST /api/routes/feedback` с
   `failureReason` (контракт уже есть) до перехода к следующему кандидату,
   чтобы backend видел деградацию в реальном времени.
3. При успехе — останавливаем цикл; `session.status` переходит в
   `connected`, как сейчас.
4. UI не показывает сам перебор отдельным шагом — сохраняем Decision 003
   (простой UX): кнопка `Подключить` во время перебора остаётся в
   состоянии "...", виден только финальный статус.
5. Тесты: unit на executor (мок `connectNativeTunnel`, порядок кандидатов,
   feedback на каждый провал, остановка на первом успехе, финальный failure,
   если кандидаты кончились).

### Definition of done

- ✅ неудачное первое подключение не требует ручного похода на `Server` —
  подтверждено живой проверкой 2026-07-09 (Decision 031);
- ✅ минимум 2 кандидата из shortlist реально перебираются автоматически при
  провале — подтверждено (Contabo → OVH);
- ✅ каждый провал долетает до backend как feedback — подтверждено
  (`routeHealth` показал реальный `penaltyScore`/`connect_refused` после
  теста);
- ✅ то же самое, но через настоящую кнопку "Подключить" на реальном
  Android-устройстве, а не напрямую вызванный executor — подтверждено
  2026-07-10 ([Decision 045](DECISIONS.md)), Шаг 2b закрыт.

## Шаг 4 — CI/CD: сборка и деплой, а не только проверка (P1)

**Статус (2026-07-09): build/up-часть закрыта и проверена вживую.** См.
[Decision 027](DECISIONS.md).
[backend/Dockerfile](../backend/Dockerfile), [frontend/Dockerfile](../frontend/Dockerfile),
[deploy/nginx/frontend.conf](../deploy/nginx/frontend.conf),
[deploy/compose.prod.yaml](../deploy/compose.prod.yaml), `compose.yaml` profile
`prod`, job'ы `deploy-staging`/`deploy-prod` в
[ci.yml](../../.github/workflows/ci.yml).

- ✅ `docker compose --profile prod build` — оба образа (backend, frontend)
  собрались чисто с первого раза;
- ✅ **закрыт пробел с миграциями**: корневой `compose.yaml` получил
  сервис `migrate` (тот же паттерн, что в `deploy/compose.prod.yaml`,
  Decision 026), `backend` ждёт `migrate: condition:
  service_completed_successfully`. Проверено на чистом `postgres_data`
  volume: `docker compose --profile prod up --build` сам гоняет миграции
  и поднимает рабочий стек без ручного вмешательства (`GET /api/session`
  → `401`, `GET /` frontend → `200`) — раньше здесь был воспроизводимый
  crash-loop (`P2021 TableDoesNotExist`);
- ⚠️ при диагностике поймана ловушка (учтено, но не устранено — это
  особенность локальной машины, не кода): на хосте параллельно слушает
  нативный (не Docker) Postgres на `localhost:5432` — миграции, прогнанные
  вручную с хоста на `localhost`, могут тихо применяться не туда и врать
  об успехе (подробности — Decision 027). В рамках docker-сети (как теперь
  и работает `migrate`) это не проблема;
- ✅ **`deploy/manual-deploy.sh` прогнан вживую (2026-07-09)** против
  реального VPS2 (Contabo, см. [Decision 030](DECISIONS.md)) с чистого
  хоста — rsync исходников, `migrate` (build+run), `up --build -d` собрали
  и подняли `postgres`/`backend`/`frontend`/`route-reprobe-worker` с первого
  раза без ручного вмешательства. `GET /api/session` → `401`, `GET /` →
  `200` — тот же живой сигнал, что и в локальной проверке Decision 027, но
  теперь через настоящий SSH/rsync-путь на настоящем сервере, а не
  `docker compose` на dev-машине. Подробности — [Decision
  033](DECISIONS.md).
- ✅ **TLS-терминатор перед control-plane (2026-07-10)**: раньше `nginx`
  слушал только `:80`, `backend` публиковал голый `:8080` — пароли,
  OTP-коды, `x-auth-session-id` ходили открытым текстом. Добавлен `caddy`
  (`deploy/Caddyfile`, `deploy/compose.prod.yaml`) — единственный сервис с
  портами наружу, проксирует на `frontend` внутри docker-сети. Два режима
  через `CONTROL_PLANE_DOMAIN`/`ACME_EMAIL` (`deploy/.env`): настоящий
  Let's Encrypt по домену, либо `tls internal` (самоподписанный сертификат,
  без домена/DNS) — подробности [Decision 039](DECISIONS.md).
- ✅ **режим `tls internal` проверен вживую локальным Docker (2026-07-10)**:
  полный `docker compose ... up -d` + `curl`/`openssl s_client` нашёл и
  закрыл реальный баг первой версии Caddyfile — catch-all адрес `:443` без
  явного хоста ронял TLS handshake даже с `tls internal` (caddy не знает,
  для какого SNI/IP выпускать сертификат без on-demand). Фикс: явный хост
  (домен или IP) в адресе сайта обязателен всегда, переключение
  ACME/internal — только через `ACME_EMAIL`. После фикса: `GET /` → `200`,
  `GET /api/session` → `401` (тот же живой сигнал, что в Decision 027/033),
  голый `:8080` недоступен, `:80` редиректит на `:443` — все через HTTPS.
  ACME/Let's Encrypt-путь по-прежнему не проверен вживую (нужен реальный
  публичный DNS) — подробности и TODO — [Decision 040](DECISIONS.md).
- ✅ **TLS-фикс реально задеплоен на боевой VPS (2026-07-10)**: тот же VPS
  (`57.128.220.83`, `deploy/ssh.env`) одновременно control-plane (жил в
  уязвимой конфигурации без TLS до этого прохода) и одна из трёх xray-нод
  VPN-транспорта — `manual-deploy.sh` прогнан вручную (`sshpass`, ssh-ключа
  не было). Нашёл и закрыл третий реальный баг: клиенты не шлют SNI при
  подключении к голому IP (RFC 6066 — SNI для доменных имён, не для
  IP-литералов) — без `default_sni {$CONTROL_PLANE_DOMAIN}` в
  `deploy/Caddyfile` handshake падал на каждом запросе по IP, хотя
  `openssl -servername` тот же хост отдавал нормально. После фикса —
  подтверждено curl'ом и с самого VPS, и снаружи: `GET /` → `200`,
  `/api/session` → `401`, `:8080` недоступен, `:80` → `308` на https.
  xray-ноды (`8443-8445`) не затронуты. Подробности — [Decision
  041](DECISIONS.md).
- ✅ **второй незащищённый control-plane найден и закрыт (2026-07-10)**:
  VPS2 (`167.86.77.100`, Contabo, второй набор кредов в `deploy/ssh.env`) —
  оставленный ещё с Decision 033 деплой backend/frontend/postgres в той же
  уязвимой конфигурации, независимая БД. Тот же TLS-фикс раскатан и туда
  (временная подмена `CONTROL_PLANE_DOMAIN` в `deploy/.env`), тот же
  результат: `200`/`401`/`308`, `:8080` недоступен, xray-нода
  `fr-contabo-1` (`:8446`) не затронута. **Незакрытый пробел**:
  `deploy/.env` — один локальный файл на оба хоста, `CONTROL_PLANE_DOMAIN`
  приходится вручную переключать перед каждым деплоем на другой VPS —
  подробности и вопрос "нужен ли Contabo как постоянный control-plane
  вообще" — [Decision 042](DECISIONS.md).
- ✅ **`manual-deploy.sh` деплоит на все хосты за один запуск (2026-07-10)**:
  закрыт пробел из Decision 042 — `deploy/ssh.env` теперь массив `CP_HOSTS`
  (`deploy/ssh.env.example` добавлен), скрипт сам подставляет
  `CONTROL_PLANE_DOMAIN` под каждый хост и продолжает с остальными, если
  один упал. Проверено вживую реальным запуском без ручных правок — оба
  известных VPS получили каждый свой домен/IP в сертификате, `200`/`401`,
  `:8080` недоступен на обоих, xray-ноды не затронуты. Подробности —
  [Decision 043](DECISIONS.md).
- ❌ deploy-job'ы `ci.yml` (`deploy-staging`/`deploy-prod`) по-прежнему не
  проверены — у проекта всё ещё нет GitHub-репозитория/`git remote`, значит
  нет secrets/environments, которые эти job'ы требуют. Deploy-job'ы
  безопасны по умолчанию: без secrets/environments (см.
  [deploy/README.md](../deploy/README.md)) они падают на первом шаге,
  которому нужен secret, и ничего не разворачивают. Это сознательно вне
  скоупа, пока нет решения заводить публичный/приватный GitHub remote —
  публикация кода наружу требует отдельного явного решения, не подразумевается
  этим шагом.

Прежде чем полагаться на CI-деплой (`deploy-staging`/`deploy-prod`) в
реальности: заведи GitHub remote, secrets и хотя бы `staging` environment.
Ручной путь (`manual-deploy.sh`) уже подтверждён и не требует ничего из
этого.

### Проблема

`.github/workflows/ci.yml` сейчас только проверяет — lint/typecheck/tests/
build. Нет ни одного `Dockerfile` для `backend`/`frontend`/worker, нет job'ы
деплоя, нет разделения на окружения, нет управления секретами для прод-БД,
`RESEND_API_KEY`, `OPS_ALERT_TELEGRAM_BOT_TOKEN`, Xray-ключей.
`compose.yaml` — dev-only (`route-reprobe-worker` делает `npm install` из
смонтированного кода при каждом старте).

### Что делать

1. `backend/Dockerfile` (+ вариант `CMD` для `worker.ts`) — multi-stage
   build, `prisma generate` внутри образа.
2. `frontend/Dockerfile` или явное решение отдать статику иначе (сейчас dev
   proxy) — зафиксировать отдельным Decision, если меняется модель раздачи.
3. Новый job `deploy` в `ci.yml`, триггерится после `quality` на `main`/
   тегах: собирает и пушит образ в `ghcr.io`, затем катит на целевой VPS
   (SSH + `docker compose pull && up -d`, либо аналог).
4. Явный шаг `prisma migrate deploy` перед перезапуском backend при деплое,
   с бэкапом БД перед прогоном на первое время.
5. Секреты — GH Actions secrets → `.env` на сервере, без секретов в
   репозитории в открытом виде.
6. Минимум 2 окружения: staging (для проверки новых Xray-нод и деплоя до
   прода) и prod.

### Definition of done

- ✅ миграции применяются автоматически и безопасно — подтверждено вживую
  дважды (локально, Decision 027; на реальном VPS2, Decision 033);
- ✅ ни один секрет не лежит в репозитории в открытом виде (`deploy/.env`,
  `deploy/ssh.env` — оба в `.gitignore`);
- 🟡 push в `main` после тестов сам выкатывает backend/frontend на staging —
  ручной путь (`manual-deploy.sh`) проверен и работает, но требует
  запускающего человека; автоматического триггера по push нет, пока нет
  GitHub remote/CI;
- ❌ prod — по тегу или ручному approve — не применимо без GitHub
  Environments (`required reviewers`), см. выше.

## Шаг 5 — Fleet provisioning: поднять или вывести Xray-ноду без ручной правки кода (P1)

**Статус (2026-07-09): закрыто, включая ранее отложенную Ansible-автоматизацию.**
`provision-node.sh` прогнан вживую на реальном VPS (см. [Decision
025](DECISIONS.md)); retire-аудит (manual vs auto-detected) добавлен и
подтверждён в браузере (см. [Decision 026](DECISIONS.md)). Теперь, когда в
парке два реальных VPS у разных провайдеров (OVH, Contabo — см. [Decision
030](DECISIONS.md)), условие "нет ещё реальных вторых-третьих VPS", из-за
которого Ansible-обвязка была сознательно отложена, больше не в силе —
написан и подтверждён вживую [`deploy/ansible/`](../deploy/ansible/)
(`provision-node.yml`/`retire-node.yml`/`reactivate-node.yml`). Подробности
— [Decision 034](DECISIONS.md).

Сделано:

- Admin API — [backend/src/server.ts](../backend/src/server.ts): `GET
  /api/admin/endpoints`, `POST /api/admin/endpoints` (регистрация),
  `PATCH /api/admin/endpoints/:endpointId` (retire/reactivate через
  `isActive`) — все за `requireAdminAuthSession`.
- [backend/src/store/endpoints.ts](../backend/src/store/endpoints.ts) —
  чистая функция `evaluateEndpointRetirement()` не даёт retire уронить
  active-inventory ниже требований `inventory-policy.ts` (`≥3` failure
  domains); 3 unit-теста зелёные.
- Ops UI — секция "Fleet — Xray-ноды" в
  [frontend/src/components/ops-screen/FleetAndHistorySections.tsx](../frontend/src/components/ops-screen/FleetAndHistorySections.tsx)
  (на момент написания этого пункта — единый `OpsScreen.tsx`, позже
  разбитый на секции, см. [CHANGELOG.md, 2026-07-10](CHANGELOG.md)),
  хук [frontend/src/hooks/useAdminEndpoints.ts](../frontend/src/hooks/useAdminEndpoints.ts):
  Retire/Reactivate прямо из Ops, рядом с alert-действиями — как и
  просили в Definition of done, без отдельного нового dashboard.
- [deploy/xray/provision-node.sh](../deploy/xray/provision-node.sh) —
  bash-скрипт: `register` (генерирует x25519 keypair через
  `docker run ghcr.io/xtls/xray-core x25519`, берёт случайные `sni`/
  `fingerprint` из стартового пула на 4 домена/3 fingerprint'а, поднимает
  Xray-контейнер, регистрирует ноду через новый Admin API),
  `retire`/`reactivate` (тот же `PATCH`, что и кнопки в Ops). **Прогнан
  вживую** на реальном VPS 4 раза (Шаг 2a, [Decision 025](DECISIONS.md)) —
  больше не "код без сборки".
- **Retire-аудит** ([Decision 026](DECISIONS.md)): `Endpoint.retiredAt`/
  `retiredReason` (миграция `20260709150000_endpoint_retire_audit`) —
  различает manual retire (не реактивируется сам на здоровый пинг) от
  `auto_health_failure` (soft-detection, реактивируется как раньше). Ops UI
  показывает причину/время на карточке неактивной ноды. Подтверждено
  вручную в браузере: retire → карточка показывает `retired: manual · ...`
  → reactivate очищает поля.
- Per-user client-id sync (`GET /api/admin/vless-clients` +
  `deploy/xray/sync-clients.sh`) закрыт в рамках Шага 2, см.
  [Decision 025](DECISIONS.md) — здесь просто ссылка, чтобы не дублировать.

Ansible-автоматизация (2026-07-09, ранее была в "не сделано"):

- [deploy/ansible/](../deploy/ansible/) — playbook'и `provision-node.yml`/
  `retire-node.yml`/`reactivate-node.yml` + роль `xray_node`, написаны после
  появления второго реального VPS (см. [Decision 030](DECISIONS.md)).
  В отличие от bash-скрипта (перегенерирует ключи на каждый `register`),
  роль идемпотентна — перечитывает crypto-материал с диска на повторных
  прогонах вместо ротации ключей, а регистрация в control-plane проверяет
  `poolCode` перед `POST`, чтобы не плодить дубликаты.
- Прогнано вживую против реального VPS (одноразовый тестовый pool на OVH,
  снесён после проверки): установка Docker (skip, если уже есть), генерация
  keypair/short-id/uuid, запуск контейнера, регистрация в control-plane — всё
  сработало; повторный прогон подтвердил идемпотентность (`changed: 0`);
  `retire-node.yml`/`reactivate-node.yml` тоже проверены вживую. По пути
  поймали и починили 2 бага (см. [Decision 034](DECISIONS.md)): auto-detect
  IP по умолчанию получал HTML вместо IP (User-Agent `ansible-httpget`
  триггерит HTML-страницу на `ifconfig.me`), и отдельно — возвращал IPv6
  вместо IPv4 на dual-stack хосте.
- Bash-скрипт (`provision-node.sh`) не удалён и остаётся рабочим путём для
  разовой ручной регистрации одной ноды — Ansible нужен, когда нод/провайдеров
  больше одного за раз.

`npm run typecheck`/`test` backend (191/191, все pre-existing flaky тесты
больше не встречались) и frontend (6/6) — зелёные. Плюс живая ручная
проверка retire/reactivate в браузере против реального backend (не только
unit-тесты) — по пути нашли и починили баг `this`-биндинга в
`store/ops-alerts.ts`, из-за которого весь Ops-экран падал с `500`
([Decision 026](DECISIONS.md)).

### Проблема

`defaultEndpointTransportConfigs` в
[backend/src/defaults.ts](../backend/src/defaults.ts) захардкожен — один
dev-узел. Нет процедуры "поднять VPS у произвольного провайдера →
сгенерировать keypair → зарегистрировать в БД" и обратной — "эту ноду
больше не выдавать". Soft-detection уже есть и работает автоматически
(`backend/src/endpoint-healthcheck-worker.ts` — 3 неудачных TCP-пинга подряд
гасят `isActive`; `routeHealth` из client probes уводит ноду из пула для
конкретной сети), но "жёсткого" вывода из ротации и подъёма замены — нет.

### Что делать

1. Provisioning-скрипт (Ansible playbook или bash + cloud-init) под минимум
   2-3 разных провайдера — важно для `inventory-policy.ts`, которая уже
   требует ≥3 независимых failure domains по provider/ASN/region.
   Устанавливает Xray-core, генерирует x25519 keypair (`xray x25519`),
   берёт `sni`/`fingerprint` из пула (Шаг 6), пишет `Endpoint` +
   `EndpointTransportConfig`.
2. Admin API для регистрации новой ноды и явного retire (`isActive: false`
   + `retiredAt`/`retiredReason`) — в дополнение к уже автоматическому флипу
   `isActive` от healthcheck worker.
3. Решить: ручное подтверждение retire или полностью автоматическое (если
   `consecutiveHealthFailures` держится N часов — предложить retire в `Ops`,
   не удалять данные автоматически, это влияет на аудит).
4. В `Ops` (уже показывает inventory risk) добавить действие "Retire
   endpoint" / "Register endpoint" рядом с существующими alert-действиями
   (acknowledge/snooze), а не как отдельный новый dashboard.

### Definition of done — выполнено

- ✅ новая нода добавляется в ротацию без правки `defaults.ts` и без деплоя
  backend (`provision-node.sh`, прогнан вживую);
- ✅ администратор выводит ноду из ротации вручную из `Ops` за одно действие
  (плюс теперь видно, почему нода неактивна — manual vs auto);
- ✅ `inventory-policy.ts` (`≥3` failure domains) продолжает соблюдаться после
  каждой ротации (`evaluateEndpointRetirement()`, не менялась).

## Шаг 6 — Устойчивость к блокировке на уровне оператора (P2)

**Статус (2026-07-09): оба пункта закрыты и подключены к маршрутам.**

- SNI/fingerprint diversity (было: один захардкоженный домен на все ноды) —
  закрыто как побочный эффект Шага 5:
  [deploy/xray/provision-node.sh](../deploy/xray/provision-node.sh) берёт
  случайный `sni`/`fingerprint` из пула на каждую регистрируемую ноду,
  `EndpointTransportConfig.sni`/`fingerprint` в схеме это уже поддерживает.
- Bridge-модель (клиент видит подмножество inventory, не весь парк) —
  дизайн и итоговая реализация зафиксированы в
  [DECISIONS.md, Decision 024](DECISIONS.md): детерминированный hash-based
  сегмент на `sha256(userId:rotationBucket:endpointId)`, сам сегмент обязан
  быть policy-compliant (переиспользует `inventory-policy.ts`), passthrough
  для маленького парка (`<=6` нод), fail-open к полному списку для
  вырожденных случаев.
  [backend/src/inventory-segmentation.ts](../backend/src/inventory-segmentation.ts)
  (`selectClientSegment()`, теперь с `pinnedEndpointIds`), 11 unit-тестов
  ([backend/src/__tests__/inventory-segmentation.test.ts](../backend/src/__tests__/inventory-segmentation.test.ts)).
  **Подключено**: `session.ts::listServers()` принимает
  `segmentation?: ServerSegmentationContext` и применяет сегмент после
  fail-closed policy-проверки на полном inventory;
  `runtime.ts::resolveRouteDecision()` передаёт `auth.userId` как
  `subjectId` и пин-лист из `currentAssignment`/`lastKnownGoodRoute`/
  `manualEndpointId` — так решены оба continuity-вопроса, которые Decision
  024 изначально откладывал (см. её "Обновление" от того же дня).
- `npm run typecheck --workspace backend` и `npm run test --workspace
  backend` (183/184, тот же pre-existing flaky тест) — зелёные, включая
  существующие `session.test.ts`/`route-policy.test.ts` без изменений в
  тестах. Не проверено против реальной Postgres/большого (>6 нод) парка —
  в dev-среде нет БД, а `defaults.ts` даёт только 1-2 endpoint'а, ниже
  `passthroughThreshold`, так что сегментация на существующих dev-данных не
  активируется — только на синтетике в unit-тестах.

### Definition of done — выполнено

- компрометация одного пользовательского аккаунта не раскрывает весь список
  нод, если парк вырастет выше `passthroughThreshold` (6 нод);
- SNI/fingerprint не идентичны на всех endpoint'ах.

### Проблема (исходная постановка, для истории)

Единственный SNI/fingerprint (`www.microsoft.com`/`chrome`) захардкожен на
все ноды — под one shot DPI-сигнатурой можно найти сразу весь парк. Полный
список серверов выдаётся любому авторизованному клиенту целиком — при
компрометации одного аккаунта или скрапинге API оператор получает весь
inventory разом.

### Что делали (для истории — исходный план, сверху уже статус выполнения)

1. Пул фасадных доменов (`sni`) и fingerprint-профилей на выбор при
   провижининге ноды (Шаг 5), не один захардкоженный домен на всех. —
   сделано.
2. Разделить "полный inventory" (для admin/Ops) и "то, что видит конкретный
   клиент" — client получает ограниченное персональное/сегментное
   подмножество (bridge-модель), возможно с ротацией во времени. — сделано.
3. Зафиксировать Decision-ом до реализации — это меняет модель доступа к
   `GET /api/session`/`servers`, затрагивает Decision 022 (авторизация
   data-plane) и требует продумать, как ranking/shortlist работают, если у
   пользователя не весь inventory, а подмножество. — сделано, см.
   [DECISIONS.md, Decision 024](DECISIONS.md).
4. Протокольная diversity (Trojan/Shadowsocks-2022 fallback,
   [ROADMAP.md, Этап 6](ROADMAP.md)) — тоже часть этой защиты, но уже в
   отдельной очереди. — не сделано, вне скоупа этого шага.

## Шаг 7 — Только теперь возвращаемся к alerting-слою

- Не берём новые фичи в ops/alerting, пока Шаги 1-6 не закрыты.
- Текущая очередь в [ROADMAP.md, Этап 6](ROADMAP.md) (внешний delivery уже
  частично сделан, more flexible escalation policy, manual resend controls)
  замораживается до этого момента.
- После Шага 6 — возвращаемся к очереди ровно там, где она сейчас описана в
  ROADMAP, не переизобретая её заново.

**Статус (2026-07-10): аудит проведён, новый код не потребовался.** См.
[Decision 046](DECISIONS.md). Пятипунктовый рабочий план `ROADMAP.md, Этап 6`
(external delivery adapter, escalation semantics, metadata reuse, admin
controls, verification) оказался уже реализован в
[backend/src/store/ops-alerts.ts](../backend/src/store/ops-alerts.ts) и
соседних модулях (`ops-alert-delivery.ts`, `ops-alert-escalation.ts`,
`ops-alert-messages.ts`) — этот код был написан до заморозки, что и было
исходной причиной приоритизации (alerting был развит дальше ядра продукта).
Проверено: `npm run test --workspace backend` (268/268, включая 24
сценария в `ops-alerts.test.ts` на cooldown/cadence/quiet-window/retry/resend),
manual resend и digest-toggle подключены в UI
([PersistedAlertTile.tsx](../frontend/src/components/ops-screen/PersistedAlertTile.tsx),
[useAdminUsers.ts](../frontend/src/hooks/useAdminUsers.ts)), не только в API.

Открыто (не блокирует Шаг 7, но не сделано):

- живая проверка реальной Telegram/email доставки (не через мок-транспорт
  в тестах) — `RESEND_API_KEY`/`OPS_ALERT_TELEGRAM_BOT_TOKEN` не
  сконфигурированы ни на одном боевом VPS;
- решение "нужен ли отдельный specialized surface для ops-наблюдения"
  (`ROADMAP.md`, "Ближайшая очередь", п.2) — сознательно не принято,
  явного сигнала для этого пока нет, текущий `Ops`-экран справляется.

## Как это соотносится с другими документами

- [ROADMAP.md](ROADMAP.md) — этот план временно переопределяет порядок
  "что делаем дальше"; после Шага 6 роадмап продолжается как обычно.
- [PRODUCT.md](PRODUCT.md) — Шаг 2 является прямой реализацией центрального
  обещания продукта ("нажал — подключился").
- [DECISIONS.md](DECISIONS.md) — решение по срокам native-обвязки (Этап 2b)
  должно быть зафиксировано отдельной записью сразу после выбора подхода.
