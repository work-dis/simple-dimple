# Network Intelligence Layer

Этот документ фиксирует практическую модель adaptive routing для проекта.

Главная идея:

> мы строим не просто VPN с несколькими протоколами, а слой сетевой адаптации поверх нескольких transport-путей

## 1. Источник истины

Сервер не знает наверняка, что реально прошло до клиента.

Он видит только косвенные признаки:

- порт открыт или закрыт
- handshake был или не был
- сколько байт прошло
- как долго жило соединение

Но выводы вида:

- у конкретного оператора работает `VLESS`
- у того же оператора не работает `Trojan`
- на `wifi` в одном регионе все хорошо, а на `mobile` нет

должны строиться только на client probe data.

## 2. Recovery order на клиенте

После смены сети, cold start после неудачи или обрыва клиент идет по такому порядку:

1. `last_known_good_route`
2. другой transport на том же `IP`
3. другой `IP` внутри того же пула
4. другой провайдер или `ASN` с другим transport
5. сохранить победителя локально
6. отправить probe result в telemetry

Диагностический смысл "другого transport на том же IP":

- если умерли все transports на одном `IP`, вероятен блок `IP`, подсети или `ASN`
- если умер только один transport, вероятна фильтрация handshake или сигнатуры
- если `TCP` жив, а `UDP` нет, вероятна фильтрация `UDP`
- если проблема воспроизводится только у части клиентов, вероятна зависимость от оператора, региона или локальной сети

Важно:

несколько inbound-профилей на одном `IP` полезны для диагностики и быстрого fallback, но не считаются резервом от `IP`-блока.

## 3. Что именно клиент должен отправлять

Минимальный probe report:

```text
network_type
carrier
asn
country
region
endpoint_id
ip_id
transport_profile_id
result
latency_ms
bytes_sent
bytes_received
tested_at
app_version
```

Где `result` принимает одно из значений:

- `dns_fail`
- `tcp_fail`
- `tls_fail`
- `auth_fail`
- `connected`
- `unstable`

Опционально можно добавить:

- `disconnect_after_ms`
- `retry_count`
- `tunnel_uptime_ms`
- `network_fingerprint_hash`

## 4. Privacy model

Для analytics и ranking не нужно хранить лишние данные.

Нужно:

- грубый тип сети
- carrier и `ASN`
- грубую страну и регион
- технический результат теста
- агрегированные метрики качества

Не нужно:

- полный клиентский `IP`
- историю сайтов
- URL назначения
- payload трафика

Подход:

- хешировать сетевой отпечаток
- работать с агрегатами по time window
- задавать срок хранения raw probe events

## 5. Backend entities

Базовая логическая модель:

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

Практически это удобно разбить на сущности:

- `Provider`
- `Endpoint`
- `EndpointIp`
- `TransportProfile`
- `ClientProbeResult`
- `AvailabilityAggregate`
- `ClientRouteCache`

### Provider

- `id`
- `name`
- `asn`
- `country`
- `region`
- `status`

### Endpoint

- `id`
- `provider_id`
- `server_name`
- `country`
- `region`
- `status`

### EndpointIp

- `id`
- `endpoint_id`
- `ip_address`
- `family`
- `role`
- `status`

### TransportProfile

- `id`
- `endpoint_ip_id`
- `protocol`
- `transport`
- `security_layer`
- `sni`
- `fingerprint`
- `port`
- `status`

### ClientProbeResult

- `id`
- `network_fingerprint_hash`
- `network_type`
- `carrier`
- `asn`
- `country`
- `region`
- `endpoint_id`
- `endpoint_ip_id`
- `transport_profile_id`
- `result`
- `latency_ms`
- `bytes_sent`
- `bytes_received`
- `tested_at`
- `app_version`

### AvailabilityAggregate

- `id`
- `network_fingerprint_hash`
- `endpoint_ip_id`
- `transport_profile_id`
- `time_window_start`
- `time_window_end`
- `success_rate`
- `median_connect_time_ms`
- `disconnect_rate`
- `sample_count`

### ClientRouteCache

- `id`
- `user_id`
- `network_fingerprint_hash`
- `last_transport_profile_id`
- `last_endpoint_ip_id`
- `last_success_at`

## 6. Ranking model

Клиент не должен получать один конфиг.

Он должен получать shortlist кандидатов:

```text
1. VLESS / IP-7 / Provider-B — 93%
2. Trojan / IP-7 / Provider-B — 81%
3. Shadowsocks / IP-22 / Provider-C — 64%
```

Ranking учитывает:

- успешность по текущему `network_fingerprint`
- свежесть измерений
- время подключения
- частоту обрывов
- тип failure (`timeout`, `dns_blocked`, `handshake_failed` и т.д.)
- силу сигнала: сколько свежих и независимых probe-ов подтверждают деградацию
- diversity по `IP`, `provider`, `ASN`

Нельзя отдавать первые три маршрута с одинаковым failure domain.

Минимальные правила shortlist:

- кандидат `#1`: лучший last-known-good или лучший по текущей сети
- кандидат `#2`: другой transport или другой `IP` в близком failure domain для быстрой диагностики
- кандидат `#3`: другой provider или `ASN`
- кандидат `#4+`: emergency paths

## 7. Control plane и telemetry plane

Control plane не должен быть единственной обязательной точкой связи.

Нормально:

- несколько control endpoints
- разные провайдеры и `ASN`
- control plane отделен от data plane
- telemetry можно отправить позже, если на момент теста связь не работает

Подход клиента:

1. попытаться отправить короткий отчёт напрямую
2. если не получилось, сохранить локально
3. отправить позже
4. при наличии туннеля догрузить через него

## 8. API expectations

Минимально backend должен уметь:

- принимать probe reports
- агрегировать доступность по time window
- возвращать shortlist кандидатов
- помечать деградировавшие `IP` и transport profiles
- хранить last-known-good route для пользователя или сетевого отпечатка

Текущий dev progress:

- persisted `last-known-good route` уже хранится отдельно от assignment
- backend пишет его после успешного `connect`
- policy-engine сначала пытается взять точное совпадение по `network_fingerprint`, а затем уже уходит в ranking/baseline flow
- shortlist теперь уже старается разносить fallback-кандидатов по `provider / ASN / IP`, а не только по transport profile
- policy теперь также временно уводит деградировавшие endpoints из основного candidate pool на основе свежих `probe results`
- ranking уже начал штрафовать маршруты не только по общему fail-rate, но и по свежести и тяжести свежих probe failures
- policy теперь получает не только avoid-list, но и компактные `routeHealth` snapshots для explainable penalties
- feedback endpoint теперь реально пишет и `route_events`, и зеркальный `probe_report`
- `resolve/re-probe` workflow больше не ограничен in-memory таймером: теперь jobs живут в persisted `RouteReprobeJob` store и исполняются отдельным lease-aware worker process
- `Ops` поверх этого trail теперь показывает не только raw события, но и первые explainable metrics: `fallback pressure`, `degradation windows`, `recovery time`
- тот же `Ops` слой теперь показывает и execution health самого persisted reprobe worker-а: queue lag, lifecycle counts, worker activity и recent attempt audit по jobs

Примеры API:

- `POST /probes`
- `GET /routes/candidates`
- `POST /api/routes/resolve`
- `POST /api/routes/feedback`
- `GET /api/ops/route-decisions`
- `GET /api/ops/route-reprobe-jobs`
- `POST /api/ops/route-reprobe-jobs`

## 9. Что это меняет для продукта

Снаружи ничего не должно усложняться.

Пользователь по-прежнему видит:

- статус
- кнопку `Подключить`
- максимум один простой secondary action

Но внутри продукта появляется важный системный слой:

> adaptive availability matrix по сети, оператору, региону, IP и transport-профилю
