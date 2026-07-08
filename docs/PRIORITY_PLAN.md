# Priority Plan: OTP-утечка → реальный транспорт → alerting

Этот документ фиксирует порядок работ, который временно переопределяет
"что делаем дальше" из [ROADMAP.md](ROADMAP.md): пока не закрыты Шаг 1 и Шаг 2
ниже, новые фичи в ops/alerting-слое ([ROADMAP.md, Этап 6](ROADMAP.md)) не берём.

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

### Definition of done для Шага 2

- есть минимум один живой сервер с рабочим VLESS+REALITY inbound;
- backend реально выдаёт рабочий connection-конфиг, а не только метаданные
  решения;
- есть минимальный native-клиент (пусть черновой APK), который реально
  поднимает VPN-туннель на устройстве;
- кнопка "Подключить" хотя бы для одного протокола означает настоящее VPN-
  соединение, а не переключение поля `status` в БД.

## Шаг 3 — Только теперь возвращаемся к alerting-слою

- Не берём новые фичи в ops/alerting, пока Шаг 1 и Шаг 2 не закрыты.
- Текущая очередь в [ROADMAP.md, Этап 6](ROADMAP.md) (внешний delivery уже
  частично сделан, more flexible escalation policy, manual resend controls)
  замораживается до этого момента.
- После Шага 2 — возвращаемся к очереди ровно там, где она сейчас описана в
  ROADMAP, не переизобретая её заново.

## Как это соотносится с другими документами

- [ROADMAP.md](ROADMAP.md) — этот план временно переопределяет порядок
  "что делаем дальше"; после Шага 2 роадмап продолжается как обычно.
- [PRODUCT.md](PRODUCT.md) — Шаг 2 является прямой реализацией центрального
  обещания продукта ("нажал — подключился").
- [DECISIONS.md](DECISIONS.md) — решение по срокам native-обвязки (Этап 2b)
  должно быть зафиксировано отдельной записью сразу после выбора подхода.
