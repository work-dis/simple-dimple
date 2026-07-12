# Roadmap

Этот документ фиксирует ближайший план разработки проекта.

Он нужен для того, чтобы мы не возвращались случайно к старой модели "панели управления" и не раздували интерфейс.

> Текущий приоритетный порядок работ временно переопределён отдельным
> документом: [PRIORITY_PLAN.md](PRIORITY_PLAN.md) — сначала закрыть
> OTP-утечку в auth-verification, затем поднять реальный VLESS+REALITY
> транспорт через Xray, и только потом продолжать Этап 6 в части
> alerting/escalation ниже.

## Главный принцип

Приоритет проекта:

1. простой пользовательский сценарий
2. mobile-first PWA
3. одна главная кнопка
4. максимум две кнопки на главном экране
5. техническая сложность должна жить внутри, а не в UI

## Что уже решено

Это уже не обсуждается как базовое направление:

- основной клиент проекта — один `PWA`
- `frontend` — главный UI-контур
- админский интерфейс не должен жить на главном пользовательском экране
- проект должен быть готов к упаковке в `Android/iOS`

## Этап 1. Упростить главный экран

Цель:

Сделать настоящий `simple dimple` UX.

Что должно быть на главном экране:

- статус подключения
- одна большая кнопка `Подключить`

Что допустимо дополнительно:

- кнопка `Сервер`
- или кнопка `Аккаунт`

Что нужно убрать с главного экрана:

- карточки в стиле dashboard
- длинные блоки текста
- технические поля
- JSON
- admin controls
- сложные формы логина на первом экране, если их можно упростить

Текущий прогресс:

- главный экран уже упрощен до статуса, одной главной кнопки и перехода в `Server`
- список серверов вынесен с главной поверхности в отдельный экран
- admin-кнопки по-прежнему не живут в основном пользовательском потоке, а `Ops/Admin` доступны только администратору

## Этап 2. Разделить пользовательский и служебный слои

Цель:

Не смешивать обычного пользователя и администрирование в одном UX.

Что делаем:

- пользовательский слой остается минимальным
- admin-функции уводим в отдельный скрытый маршрут или отдельный режим
- серверные метрики и health-check не должны мешать обычному подключению

## Этап 3. Mobile-first navigation

Цель:

Подготовить интерфейс к реальному использованию на телефоне.

Планируемые экраны:

- `Home`
- `Server`
- `Account`

Текущий прогресс:

- `Home` и `Server` уже разделены внутри `frontend`
- `Account` уже добавлен как отдельный служебный экран
- `Ops` и `Admin` уже вынесены в отдельные admin-only экраны, а не встроены в пользовательский сценарий

Если какой-то экран не нужен пользователю каждый день, он не должен жить на главной поверхности приложения.

## Этап 4. Упаковка в Android/iOS

Цель:

После стабилизации UX подключить нативную оболочку.

Что делаем:

- подключаем `Capacitor`
- собираем Android shell
- затем iOS shell

Важно:

Сначала делаем хороший PWA UX.
Потом упаковываем.
Не наоборот.

## Этап 5. Техническое развитие без усложнения UX

Это можно развивать дальше, но только не через перегрузку главного экрана:

- billing
- subscriptions
- multi-server improvements
- health checks
- anti-DPI tuning
- live stats

Текущий прогресс:

- в проект уже добавлен `Prisma + PostgreSQL`-каркас и initial migration
- локальный `PostgreSQL` теперь поднимается через `compose.yaml`, а runtime уже работает только через БД
- поверх `user/account` уже добавлен минимальный auth foundation с `login/password` flow без подтверждения email
- поверх этого уже добавлен dev-stage verification flow для `email` и `Telegram` через одноразовый код
- `server_pools` и `endpoints` уже подняты в `PostgreSQL` как основа server-domain слоя
- минимальный `client probe report` уже начал жить в runtime через `network_fingerprints` и `probe_reports`
- первичный ranking skeleton уже считает `route_success_rollups` и `route_rankings` на основе client probes
- backend уже фиксирует `user_endpoint_assignments` как baseline для реальной выдачи маршрута
- черновая схема разделения `clients / telemetry / analytics / ops` уже зафиксирована в docs

## Этап 6. Multi-path routing и живучесть сети

Цель:

Не зависеть от одного протокола, одного IP или одного провайдера.

Базовый набор путей:

- primary: `VLESS + REALITY + TCP`
- fallback: `Trojan + TLS + TCP`
- emergency fallback: `Shadowsocks 2022 + TCP`

Что делаем:

- добавляем policy engine выбора маршрута в клиенте или shared core
- сохраняем последний рабочий путь локально
- периодически перепроверяем альтернативные маршруты
- быстро убираем деградировавшие IP из выдачи
- не показываем transport-выбор как обязательный UX-шаг
- после смены сети сначала проверяем last-known-good route, а затем идем по матрице fallback-решений
- используем "другой transport на том же IP" как диагностический шаг, а не как защиту от IP-блока

Текущий прогресс:

- backend уже строит `routePolicy` с shortlist и assignment reasons вместо простой постфактум-записи выбора
- policy-engine уже вынесен в отдельный модуль `backend/src/route-policy.ts`, а не живет внутри HTTP-роутов
- persisted `last-known-good route` уже хранится отдельно от assignment, с `network fingerprint` и TTL
- compact `decision trace` уже добавлен в `routePolicy` как internal metadata без усложнения главного UX
- shortlist теперь уже старается разносить кандидатов по `provider / ASN / IP`, а trace показывает достигнутый diversity stage
- transport-diagnostic fallback теперь тоже сначала старается выйти из того же regional domain, а не только сменить transport/IP внутри близкого кластера
- `Ops` summary теперь тоже считает inventory risk по активным endpoint-ам (`provider / ASN / pool / regional domain`) и поднимает explainable alert, если сам server inventory слишком узкий
- active inventory теперь уже закреплён как fail-closed policy invariant: backend не продолжает `session/resolve/connect/server` flow, если активный inventory не даёт минимум `3` независимых failure domains по `provider / ASN / region`
- explainability этого инварианта теперь тоже поднята до явного контракта: `inventoryHealth` возвращает `failedDimensions` и `policyViolationMessage`, а не только агрегатный `riskLevel`
- feedback-loop для деградировавших маршрутов уже добавлен поверх свежих `probe reports` по текущему `network fingerprint`
- ranking теперь уже умеет учитывать и похожие сети с контролируемым весом, а retention для telemetry задан явно
- `route feedback` теперь реально пишет и `route_events`, и зеркальный `probe_report`, а не только notes
- `route-reprobe` больше не живет только как dev-очередь в памяти: появился persisted job-контур с lease-aware polling worker и теми же admin-only enqueue/list endpoints
- `Ops` теперь поднимается от raw event feed к первым explainable quality metrics: `fallback pressure`, `degradation windows`, `recovery time`
- explainable route-quality слой в `Ops` уже расширен до `SLA windows`, `provider/ASN pressure` и `recovery by failure domain`
- persisted worker execution уже умеет `retry/backoff`, stale-lease reclaim и `dead-letter` lifecycle с attempt audit в самом job store
- execution polling уже физически вынесен из API-процесса в отдельный `worker` entrypoint с общим backend runtime
- `Ops` теперь уже показывает worker execution dashboard: lifecycle counts, queue lag, worker activity timestamps и recent reprobe jobs
- `Ops` теперь уже связывает worker execution и route quality через `execution impact`, чтобы было видно, сколько quality-сигналов накопилось после последнего успешного reprobe completion
- recent reprobe jobs теперь уже дают более явный job-level drilldown: network quality impact, candidate health context и короткий decision-friendly разрез без ручной сверки по raw events
- поверх этого `Ops` теперь уже поднимает compact alerting/retention summary: active alerts, overall severity и явные retention windows для jobs / route events / probe reports / ranking aggregates
- persisted `inventory-failure-domain-risk` alert теперь тоже хранит тот же explainable diagnosis, что и summary: `failedDimensions`, policy message и текущие inventory counts materialize-ятся в alert metadata/detail
- escalation preview и local delivery message для inventory-alert теперь тоже уносят наружу конкретный policy breakdown, а не только общий alert text
- рядом с attention summary `Ops` теперь уже показывает compact history последних почасовых окон: feedback mix, fallback resolves и job lifecycle signals без отдельного timeline endpoint
- persisted reprobe jobs теперь уже дают отдельные `worker timeline` и `failure drilldown` секции: chronological audit trail и explainable failure clusters поверх attempt audit
- history/drilldown слой теперь уже расширен и вширь, и вглубь: появился `daily ops history` поверх hourly окон и отдельные `job network hotspots` по сетям, где реально копятся persisted jobs и quality-сигналы
- поверх этого `Ops` теперь уже поднимает и `worker-specific` triage layer: compact worker alerts и worker hotspots, чтобы было видно, какой именно worker копит retries, lease churn или dead-letter jobs
- поверх уже широкого summary `Ops` теперь ещё и выбирает focused triage drilldown для одного `worker`, одной `network` и одного `job trail`, чтобы админ начинал расследование с самого проблемного среза
- **протокольная diversity стала реальной, не только vitrine-данными** ([Decision 052](DECISIONS.md), 2026-07-12): `Trojan+TLS` и `Shadowsocks-2022` теперь реально выдают `connectionConfig` (`TrojanTransportConfig`/`ShadowsocksTransportConfig` в Prisma-схеме, `buildTrojanConnectionConfig`/`buildShadowsocksConnectionConfig`), а не только числятся в `defaults.ts` как protocol-поле без транспорта. Fallback-порядок в `route-policy.ts` теперь явно двухступенчатый: сначала `same_protocol_fallback` (другой сервер с тем же протоколом), и только затем `transport_diagnostic_fallback` (смена протокола) — раньше это была одна стадия, которая могла сразу перескочить на другой протокол. **Обновление (2026-07-12, [Decision 053](DECISIONS.md)): реальный Trojan+Shadowsocks-2022 inbound поднят на `57.128.220.83` рядом с рабочим VLESS** (три inbound'а одного xray-core процесса, разные порты) — `provision-node.sh register` теперь одной командой поднимает все три протокола на любом новом хосте. Живая проверка через reference-клиент прошла для обоих новых протоколов; по пути найдены и исправлены два реальных бага в self-signed Trojan-сертификатах (нужен SAN, не только CN; `pinnedPeerCertSha256` — hex, не base64, и не `pinnedPeerCertificateChainSha256`). **Обновление (2026-07-12, [Decision 054](DECISIONS.md)): пользовательский UI тоже готов** — экран "Конфигурации серверов" в Account (per-server/per-protocol `uri` + copy, лениво через `POST /api/routes/resolve`) и под-экран "Дополнительные настройки" за Server (`RouteHealthSnapshot` на пользователя) — оба вне Home, минимализм главного экрана сохранён. **Обновление (2026-07-12, [Decision 055](DECISIONS.md)): `VpnTunnelPlugin.kt` теперь строит Trojan/Shadowsocks-2022 outbound** (не только VLESS+REALITY), плюс исправлен независимый баг — client-side auto-fallback executor обрубал shortlist на 4 кандидата вместо реальной длины от backend. Kotlin-код собран реальным компилятором (`./gradlew compileDebugKotlin`, JDK 21), но **не проверен на устройстве** — нет `adb`/эмулятора в этой сессии; до живой проверки native fallback фильтруется до `protocol === "vless"`.

Ближайшая очередь после этого слоя (заморожена до закрытия Шагов 1-2 из
[PRIORITY_PLAN.md](PRIORITY_PLAN.md) — OTP-фикс и реальный VLESS+REALITY
транспорт):

1. решить, нужен ли под этот слой уже реальный внешний alert delivery path
2. затем уже думать, стоит ли уводить часть ops-наблюдения в ещё более специализированный surface
3. параллельно продолжать держать focused drilldown и persisted alert semantics синхронизированными, а не превращать их в ещё один непрозрачный dashboard

Практически это значит:

- `POST /api/routes/resolve` уже должен переиспользоваться и online-flow, и background jobs без расхождения логики
- фоновые jobs уже должны жить в persisted job store, а не как невидимый таймер в памяти
- worker execution-контракт уже должен переживать ошибки через persisted retries/backoff, reclaim просроченного lease и `dead-letter` fallback
- следующий шаг — решать, нужен ли поверх текущего focused drilldown уже внешний alert delivery path, а не просто ещё больше summary-карточек

Локально для этого репозитория следующий шаг лучше фиксировать так:

1. подключить реальный `Telegram/email` transport поверх уже работающего local delivery log
2. решить, нужен ли отдельный batch/digest mode для `watch`-alerts
3. при необходимости добавить multi-step escalation chains поверх текущего escalation preview и persisted delivery trail

Что сознательно не делаем на этом шаге:

- не переписываем существующий local-first lifecycle `ops_alerts`, потому что storage/feed/preview/delivery baseline уже работает
- не строим отдельный новый dashboard, пока текущий `Ops` surface еще справляется
- не раздуваем alerting до полноценного incident-management слоя раньше, чем появится честный внешний delivery path

**Статус (2026-07-10): рабочий план ниже уже закрыт кодом, написанным до
заморозки этого шага в `PRIORITY_PLAN.md` — см. [Decision
046](DECISIONS.md).** Открытым остаётся только пункт 2 из "Ближайшей
очереди" выше (нужен ли отдельный specialized surface) — это решение, не
код, и явного триггера для него пока нет.

Рабочий план под этот шаг:

1. **External delivery adapter**
   Поверх существующего persisted `OpsAlertDelivery` добавить реальный transport-adapter для `Telegram/email`, не ломая local delivery log и explainable execution trail.
2. **Escalation semantics**
   Решить, какие alert-ы уходят `immediate`, какие могут копиться в `digest`, и как это связано с текущими `severity/status` и admin contacts.
3. **Metadata reuse**
   Сохранять inventory/job-quality diagnosis тем же explainable object (`detail`, metadata, preview message), чтобы внешний delivery не пересобирал смысл alert-а заново.
4. **Admin controls**
   При необходимости добавить явные knobs для digest/manual resend/escalation chain, но поверх уже существующего persisted alert lifecycle.
5. **Verification**
   Закрыть шаг тестами transport-adapter, retry/failure semantics, message rendering и обновить docs так, чтобы следующий шаг уже обсуждал только более сложные escalation policies, а не базовую доставку.

Критерий готовности этого инкремента:

- alert можно не только увидеть локально, но и реально доставить во внешний канал без потери explainable metadata
- local delivery log и внешний transport не расходятся по semantics одного и того же alert-а
- `watch` vs `critical` alerts имеют понятное правило: immediate или digest, а не случайную ручную отправку
- admin по-прежнему может отследить весь lifecycle alert-а через persisted feed, preview и delivery trail

Текущий прогресс по этому плану:

- `ops_alerts` schema и persisted lifecycle уже добавлены в backend
- базовый local-first detector уже вынесен в отдельный backend module и materialize-ит alerts в persisted feed без прямой зависимости от `operationalSummary.alerts`
- admin-only API для `list / acknowledge / snooze / unacknowledge` уже поднят
- `Ops` UI для persisted alerts feed и lifecycle actions уже тоже поднят
- persisted alerts теперь дополнительно refresh-ятся из worker/runtime контура, а не только из read-path `GET /api/ops/alerts`
- escalation preview поверх admin contacts уже тоже поднят, чтобы alert можно было читать как будущий delivery object, а не только как локальную запись
- local delivery execution поверх preview-слоя теперь тоже поднят: backend materialize-ит persisted delivery log на `POST /api/ops/alerts/:alertId/deliver`, а `Ops` умеет показать recent delivery entries
- manual retry поверх persisted delivery trail теперь тоже поднят: failed `immediate` attempt можно переотправить как single retry, а failed `digest` attempt переигрывает весь recipient-specific batch одним новым delivery execution trail
- manual resend для уже успешных delivery entries теперь тоже поднят: delivered `immediate` attempt можно осознанно отправить повторно, а delivered `digest` attempt переигрывает тот же recipient-specific batch без подмены под transport-failure
- тонкая escalation policy тоже уже начала жить в runtime: обычные `deliver` и `digest-deliver` теперь уважают cooldown по recent successful deliveries, чтобы один и тот же recipient не получал повторный alert слишком часто
- поверх этого `watch` digest теперь тоже живёт уже не как полностью произвольный ручной batch: digest cadence удерживает recipient-а, если ему уже недавно уходил другой successful `watch` digest, даже когда это уже не тот же самый alert-set
- поверх cooldown+cadence `watch` digest теперь ещё и уважает quiet window / delivery window: primary tier не уходит вне разрешённых UTC-часов, но secondary after-hours fallback всё ещё может принять batch, если он вообще настроен
- inventory-policy diagnosis уже тоже проходит через весь alerting контур одинаково: summary, persisted alert tile, alert metadata и escalation/local delivery message используют один и тот же `failedDimensions/policyViolationMessage` contract
- следующий инкремент теперь уже логично смещается к ещё более гибким escalation rules и, при необходимости, user- or tier-specific windows, а не назад к базовым operator actions или delivery lifecycle

## Этап 7. Независимые server pools

**Статус (2026-07-10): цель этапа (3 провайдера) сознательно не достигнута
из-за бюджетного ограничения — см. [Decision 047](DECISIONS.md).**
`inventory-policy.ts` понижен до `MINIMUM_INDEPENDENT_FAILURE_DOMAINS = 2`,
задеплоен на оба боевых хоста; 2 fake-ноды (`Germany Test Node`,
`Netherlands Test Node`) физически удалены из `Endpoint`, не просто
retired. Живой инвентарь теперь — 2 честных записи (OVH, Contabo) без
единого fake-лейбла. Это осознанный компромисс, не техническая
случайность — когда бюджет позволит третий VPS, стоит вернуть порог к `3`
и пройти этот этап по первоначальной цели.

Цель:

Чтобы блокировка одного `IP`, подсети или `ASN` не убивала весь сервис.

Что делаем:

- разносим primary и fallback-пути минимум по трем независимым провайдерам
- храним metadata по `ASN`, провайдеру, стране и transport capabilities
- строим выдачу нод не вокруг одного дата-центра, а вокруг независимых failure domains
- вводим telemetry по операторам, регионам и времени деградации

Важно:

Три протокола на одном `VPS` не считаются настоящей отказоустойчивостью.

## Этап 8. Client probes и telemetry

**Статус (2026-07-10): закрыт.** См. [Decision 048](DECISIONS.md).

Цель:

Собирать реальную картину доступности по операторам, регионам и типам сетей со стороны клиента, а не гадать по серверным логам.

Что делаем:

- вводим минимальный client probe report — сделано, `submitProbeReport()`/`reportCandidateFailure()`
- сохраняем только грубую сетевую metadata и технический результат попытки — сделано, `ProbeReport`/`RouteEvent` не хранят client IP
- не храним полный клиентский `IP` и историю пользовательского трафика — сделано, никогда и не собирался
- если отправка telemetry не удалась, клиент кеширует отчёт локально и отправляет позже — **было не сделано, закрыто 2026-07-10**: до этого оба места (`submitProbeReport`, `reportCandidateFailure`) молча теряли отчёт в `catch`-блоке. Добавлен [frontend/src/lib/telemetryQueue.ts](../frontend/src/lib/telemetryQueue.ts) — localStorage-очередь (кап 20 записей), `flushTelemetryQueue()` вызывается при старте приложения ([App.tsx](../frontend/src/App.tsx))

Текущий прогресс:

- оба пути отправки telemetry (`submitProbeReport` в [network.ts](../frontend/src/lib/network.ts), `reportCandidateFailure` в [useRouteSession.ts](../frontend/src/hooks/useRouteSession.ts)) теперь при неудачной отправке (не-`ok` ответ или сетевой сбой) кладут отчёт в очередь вместо потери
- 5 unit-тестов на очередь ([telemetryQueue.test.ts](../frontend/src/lib/__tests__/telemetryQueue.test.ts)): пустая очередь, успешная досылка убирает запись, неудачная — оставляет и повторяет на следующем flush, сетевой throw обрабатывается так же, размер очереди ограничен
- `npm run test --workspace frontend` (11/11), `npm run check --workspace frontend`, `npm run lint` (весь репозиторий) — зелёные

Важно:

Сервер не является источником истины о доступности для конкретного оператора. Источник истины — клиентский probe.

## Этап 9. Ranking engine для выдачи кандидатов

Цель:

Выдавать клиенту не один статичный конфиг, а shortlist маршрутов с максимальной вероятностью успеха.

Что делаем:

- агрегируем результаты по `network_fingerprint × endpoint_ip × transport_profile × time_window`
- считаем `success_rate`, `median_connect_time`, `disconnect_rate`, `sample_count`
- строим рейтинг кандидатов под конкретную сеть клиента
- отдаем клиенту несколько маршрутов в порядке вероятности успеха

Текущий прогресс:

- ranking уже служит входом для `routePolicy`, а не только для переупорядочивания полного списка серверов
- `GET /api/session` и `POST /api/connect` уже работают вокруг shortlist-кандидатов
- `probe report` теперь умеет нести отдельный `failureReason`, а не только общий `result`
- ranking теперь штрафует маршруты не бинарно, а по свежести probe-ов, типу failure и силе накопленного сигнала
- поверх этого backend уже собирает `routeHealth` snapshots с `penaltyScore`, `confidence`, `dominantFailureReason` и `status`
- fallback-кандидаты внутри shortlist теперь уже выбираются по health-aware приоритету, а не только по diversity-совпадению
- primary-кандидат теперь тоже может быть понижен через `routeHealth`, если penalty signal уже достаточно сильный и рядом есть healthier маршрут
- отдельный `POST /api/routes/resolve` уже добавлен как чистый resolve-контракт поверх текущего policy-engine
- `POST /api/routes/feedback` уже добавлен и теперь замыкает feedback-loop через `route_events` и зеркальный telemetry input

## Правило принятия решений

Перед добавлением любого нового UI-элемента задаем вопрос:

> Это помогает пользователю быстрее подключиться или только делает интерфейс тяжелее?

Если элемент не помогает основному сценарию, он не должен жить на главном экране.
