# Roadmap

Этот документ фиксирует ближайший план разработки проекта.

Он нужен для того, чтобы мы не возвращались случайно к старой модели "панели управления" и не раздували интерфейс.

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
- feedback-loop для деградировавших маршрутов уже добавлен поверх свежих `probe reports` по текущему `network fingerprint`
- ranking теперь уже умеет учитывать и похожие сети с контролируемым весом, а retention для telemetry задан явно
- `route feedback` теперь реально пишет и `route_events`, и зеркальный `probe_report`, а не только notes
- `route-reprobe` больше не живет только как dev-очередь в памяти: появился persisted job-контур с lease-aware polling worker и теми же admin-only enqueue/list endpoints
- `Ops` теперь поднимается от raw event feed к первым explainable quality metrics: `fallback pressure`, `degradation windows`, `recovery time`
- explainable route-quality слой в `Ops` уже расширен до `SLA windows`, `provider/ASN pressure` и `recovery by failure domain`
- persisted worker execution уже умеет `retry/backoff`, stale-lease reclaim и `dead-letter` lifecycle с attempt audit в самом job store
- execution polling уже физически вынесен из API-процесса в отдельный `worker` entrypoint с общим backend runtime
- `Ops` теперь уже показывает worker execution dashboard: lifecycle counts, queue lag, worker activity timestamps и recent reprobe jobs

Ближайшая очередь после этого слоя:

1. связывать job-level execution signals с более подробным ops-наблюдением
2. после этого углублять admin/ops surface до более явных job-level drilldowns
3. затем добавлять alerting/retention поверх уже поднятых worker health metrics

Практически это значит:

- `POST /api/routes/resolve` уже должен переиспользоваться и online-flow, и background jobs без расхождения логики
- фоновые jobs уже должны жить в persisted job store, а не как невидимый таймер в памяти
- worker execution-контракт уже должен переживать ошибки через persisted retries/backoff, reclaim просроченного lease и `dead-letter` fallback
- следующий шаг — связывать job-level observability с route-quality metrics, чтобы было видно не только "worker тормозит", но и "как это влияет на decisions"

## Этап 7. Независимые server pools

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

Цель:

Собирать реальную картину доступности по операторам, регионам и типам сетей со стороны клиента, а не гадать по серверным логам.

Что делаем:

- вводим минимальный client probe report
- сохраняем только грубую сетевую metadata и технический результат попытки
- не храним полный клиентский `IP` и историю пользовательского трафика
- если отправка telemetry не удалась, клиент кеширует отчёт локально и отправляет позже

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
