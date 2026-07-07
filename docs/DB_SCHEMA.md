# Database Schema Draft

Этот документ фиксирует черновую целевую схему данных под `PostgreSQL`.

Цель:

- заранее разделить пользовательские данные и network reports
- не смешивать `clients`, `subscriptions`, `devices` и `telemetry` в одну кучу
- подготовить понятную базу под `auth`, `ranking`, `server assignment` и дальнейшую аналитику

## Главный принцип

Логически у нас должно быть минимум четыре слоя:

1. `core` — клиенты, аккаунты, подписки, устройства, серверы
2. `telemetry` — сырые client probe reports
3. `analytics` — агрегаты и ranking inputs
4. `ops` — audit, admin actions, system events

Это не значит, что на старте нужны четыре разные физические БД.

На первом production-этапе достаточно:

- один отдельный сервер с `PostgreSQL`
- одна БД
- четкое разделение таблиц по доменам
- разные retention policy для разных слоев

## Почему не смешивать clients и reports

Нельзя хранить всё в одной общей таблице или без четкой доменной границы.

Нужно разделять:

- кто пользователь
- какая у него подписка
- какие у него устройства
- какие network probe results пришли с клиента
- какие агрегаты мы посчитали для ranking

Причины:

- privacy
- понятная схема роста
- удобство индексации
- разный срок хранения данных
- меньший риск случайно смешать PII и техническую telemetry

## Предлагаемые схемы PostgreSQL

Рекомендуемое логическое разделение внутри одной БД:

- `core`
- `telemetry`
- `analytics`
- `ops`

## 1. Core schema

Это основной продуктовый слой.

### Таблица `core.users`

Что хранит:

- базовый пользовательский профиль
- идентификаторы и статус аккаунта

Ключевые поля:

- `id uuid primary key`
- `display_name text not null`
- `contact text not null`
- `contact_type text not null`
- `is_admin boolean not null default false`
- `status text not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `member_since timestamptz not null`

Комментарии:

- `contact_type` лучше ограничить значениями вроде `telegram`, `email`
- `is_admin` полезно держать явным флагом, если нам пока не нужен полноценный `role`/RBAC слой
- `status` лучше ограничить значениями вроде `active`, `blocked`, `trial`

### Таблица `core.subscriptions`

Что хранит:

- текущий и исторический подписочный статус

Ключевые поля:

- `id uuid primary key`
- `user_id uuid not null references core.users(id)`
- `plan_code text not null`
- `status text not null`
- `started_at timestamptz not null`
- `renews_at timestamptz`
- `ends_at timestamptz`
- `auto_renew boolean not null default false`
- `source text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Индексы:

- `(user_id, status)`
- `(renews_at)`

### Таблица `core.devices`

Что хранит:

- клиентские устройства пользователя

Ключевые поля:

- `id uuid primary key`
- `user_id uuid not null references core.users(id)`
- `device_name text not null`
- `platform text not null`
- `app_version text`
- `device_fingerprint text`
- `is_current boolean not null default false`
- `last_seen_at timestamptz`
- `revoked_at timestamptz`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Индексы:

- `(user_id, revoked_at)`
- `(last_seen_at desc)`

### Таблица `core.server_pools`

Что хранит:

- логические пулы серверов по независимым failure domains

Ключевые поля:

- `id uuid primary key`
- `code text unique not null`
- `provider text not null`
- `asn integer`
- `country_code text not null`
- `region text`
- `priority integer not null`
- `is_active boolean not null default true`

### Таблица `core.endpoints`

Что хранит:

- конкретные IP/узлы/маршруты, которые можно выдавать клиенту

Ключевые поля:

- `id uuid primary key`
- `server_pool_id uuid not null references core.server_pools(id)`
- `ip_address inet not null`
- `provider text not null`
- `asn integer`
- `country_code text not null`
- `city text`
- `transport_profile text not null`
- `protocol text not null`
- `is_active boolean not null default true`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Индексы:

- `(server_pool_id, is_active)`
- `(ip_address)`
- `(asn, country_code)`

### Таблица `core.user_endpoint_assignments`

Что хранит:

- какой shortlist или основной endpoint был выдан пользователю

Ключевые поля:

- `id uuid primary key`
- `user_id uuid not null references core.users(id)`
- `device_id uuid references core.devices(id)`
- `endpoint_id uuid not null references core.endpoints(id)`
- `assignment_reason text not null`
- `assigned_at timestamptz not null`
- `expires_at timestamptz`

### Таблица `core.last_known_good_routes`

Что хранит:

- реальные успешные маршруты пользователя, которые policy-engine может безопасно переиспользовать как `last-known-good`

Ключевые поля:

- `id uuid primary key`
- `user_id uuid not null references core.users(id)`
- `device_id uuid references core.devices(id)`
- `network_fingerprint_id uuid references telemetry.network_fingerprints(id)`
- `endpoint_id uuid not null references core.endpoints(id)`
- `source_assignment_reason text`
- `last_succeeded_at timestamptz not null`
- `expires_at timestamptz`
- `created_at timestamptz not null`

Индексы:

- `(user_id, last_succeeded_at desc)`
- `(user_id, network_fingerprint_id, last_succeeded_at desc)`
- `(endpoint_id, last_succeeded_at desc)`

## 2. Telemetry schema

Это слой сырых клиентских отчётов.

Главное правило:

- минимум PII
- максимум технической пользы
- отдельный retention

### Таблица `telemetry.network_fingerprints`

Что хранит:

- грубый сетевой отпечаток клиента без хранения полного пользовательского IP

Ключевые поля:

- `id uuid primary key`
- `fingerprint_hash text unique not null`
- `network_type text`
- `carrier text`
- `asn integer`
- `country_code text`
- `region text`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Комментарий:

- `fingerprint_hash` лучше считать на стороне backend из ограниченного набора coarse-grained полей

### Таблица `telemetry.probe_reports`

Что хранит:

- сырой результат client probe

Ключевые поля:

- `id uuid primary key`
- `user_id uuid references core.users(id)`
- `device_id uuid references core.devices(id)`
- `network_fingerprint_id uuid references telemetry.network_fingerprints(id)`
- `endpoint_id uuid references core.endpoints(id)`
- `transport_profile text not null`
- `result text not null`
- `failure_reason text`
- `latency_ms integer`
- `bytes_sent bigint`
- `bytes_received bigint`
- `app_version text`
- `tested_at timestamptz not null`
- `received_at timestamptz not null default now()`

Индексы:

- `(tested_at desc)`
- `(endpoint_id, tested_at desc)`
- `(network_fingerprint_id, tested_at desc)`
- `(result, tested_at desc)`
- `(failure_reason, tested_at desc)`

Комментарий:

- эту таблицу нужно готовить под партиционирование по дате
- `result` лучше оставлять coarse-grained (`connected`, `unstable`, `failed`), а transport-specific смысл выносить в `failure_reason`

### Таблица `telemetry.route_events`

Что хранит:

- события по lifecycle подключения, если захотим хранить не только probe, но и connect/disconnect/degrade

Ключевые поля:

- `id uuid primary key`
- `user_id uuid references core.users(id)`
- `device_id uuid references core.devices(id)`
- `endpoint_id uuid references core.endpoints(id)`
- `network_fingerprint_id uuid references telemetry.network_fingerprints(id)`
- `transport_profile text not null`
- `event_type text not null`
- `feedback_result text`
- `event_reason text`
- `metadata jsonb not null default '{}'::jsonb`
- `occurred_at timestamptz not null`
- `received_at timestamptz not null default now()`

Индексы:

- `(occurred_at desc)`
- `(endpoint_id, occurred_at desc)`
- `(network_fingerprint_id, occurred_at desc)`
- `(event_type, occurred_at desc)`

Комментарий:

- для первых production feedback-loop-итераций `route_events` полезно хранить отдельно от `probe_reports`, но при этом не держать их в отрыве от ranking input

## 3. Analytics schema

Это слой агрегатов. Здесь не должны жить сырые probe events.

### Таблица `analytics.route_success_rollups`

Что хранит:

- агрегаты по окнам времени для ranking

Ключевые поля:

- `id uuid primary key`
- `time_bucket_start timestamptz not null`
- `time_bucket_end timestamptz not null`
- `network_fingerprint_id uuid references telemetry.network_fingerprints(id)`
- `endpoint_id uuid references core.endpoints(id)`
- `transport_profile text not null`
- `success_rate numeric(5,4) not null`
- `median_connect_time_ms integer`
- `disconnect_rate numeric(5,4)`
- `sample_count integer not null`
- `computed_at timestamptz not null`

Индексы:

- `(endpoint_id, transport_profile, time_bucket_end desc)`
- `(network_fingerprint_id, time_bucket_end desc)`

Комментарий:

- сам ranking может учитывать свежесть probe-а, тяжесть `failure_reason` и силу сигнала, даже если rollup хранит только компактные агрегаты

### Таблица `analytics.route_rankings`

Что хранит:

- уже посчитанный shortlist кандидатов для конкретного network fingerprint

Ключевые поля:

- `id uuid primary key`
- `network_fingerprint_id uuid references telemetry.network_fingerprints(id)`
- `endpoint_id uuid references core.endpoints(id)`
- `transport_profile text not null`
- `score numeric(8,4) not null`
- `rank_position integer not null`
- `computed_at timestamptz not null`
- `expires_at timestamptz`

## 4. Ops schema

Это служебный слой. Он не должен смешиваться с user telemetry.

### Таблица `ops.audit_logs`

Что хранит:

- важные изменения в user/subscription/device/admin слоях

Ключевые поля:

- `id uuid primary key`
- `actor_type text not null`
- `actor_id uuid`
- `action text not null`
- `entity_type text not null`
- `entity_id uuid`
- `details jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null`

### Таблица `ops.system_events`

Что хранит:

- служебные backend/system события

Ключевые поля:

- `id uuid primary key`
- `event_type text not null`
- `severity text not null`
- `details jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null`

### Таблица `ops.route_reprobe_jobs`

Что хранит:

- persisted lifecycle фоновых `resolve/re-probe` jobs, чтобы worker execution не терялся при рестарте API-процесса

Ключевые поля:

- `id uuid primary key`
- `status text not null`
- `context jsonb not null`
- `note text`
- `app_version text`
- `candidate_limit integer not null`
- `max_attempts integer not null default 3`
- `results jsonb not null`
- `recommended_endpoint_id uuid/text null`
- `candidates jsonb not null`
- `recorded_results_count integer not null default 0`
- `failure_message text`
- `next_attempt_at timestamptz`
- `attempts integer not null default 0`
- `lease_reclaimed_count integer not null default 0`
- `started_at timestamptz`
- `completed_at timestamptz`
- `dead_lettered_at timestamptz`
- `lease_expires_at timestamptz`
- `worker_id text`
- `attempt_audit jsonb not null default '[]'::jsonb`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`

Индексы:

- `(status, created_at desc)`
- `(status, next_attempt_at)`
- `(lease_expires_at)`
- `(created_at desc)`

Комментарий:

- этот слой отвечает именно за execution lifecycle job-ов
- persisted retry/backoff, stale-lease reclaim и `dead-letter` policy теперь живут прямо здесь, а не в памяти worker-а
- explainable route-quality сигналы живут не здесь, а в связке `telemetry.route_events` + `ops.route_reprobe_jobs`

## Рекомендации по разделению данных

Что связываем напрямую с пользователем:

- `core.users`
- `core.subscriptions`
- `core.devices`

Что можно связывать через `user_id`, но хранить с осторожностью:

- `telemetry.probe_reports`
- `telemetry.route_events`

Что по возможности должно работать уже на агрегатах:

- `analytics.route_success_rollups`
- `analytics.route_rankings`

Что не нужно хранить:

- полный клиентский IP как продуктовую историю
- историю пользовательского трафика
- детали сайтов/назначений

## Retention policy

Рекомендуемая стартовая политика:

- `core.*` — хранить до удаления аккаунта и истечения юридического/операционного окна
- `telemetry.probe_reports` — короткий retention, например `30-90` дней
- `telemetry.route_events` — `30-90` дней, если это не security/audit событие
- `analytics.route_success_rollups` — дольше, например `180-365` дней
- `ops.audit_logs` — дольше, по admin/security политике

## Когда разносить физически

На старте достаточно одной БД `PostgreSQL`.

О физическом разделении стоит думать, когда:

- telemetry-объем начинает давить на основную OLTP-нагрузку
- retention и privacy-политики резко отличаются
- ranking/analytics требует отдельного ресурса
- появляются отдельные команды или отдельные контуры доступа

Тогда возможный следующий шаг:

- `core` и `ops` оставить в основной БД
- `telemetry` и часть `analytics` вынести в отдельную БД или отдельный кластер

## Порядок миграции из текущего dev-стенда

1. Ввести `Prisma` или SQL migrations под `PostgreSQL`
2. Поднять `core.users`, `core.subscriptions`, `core.devices`
3. Перенести текущий `Account` с файлового состояния на таблицы `core.*`
4. Добавить `core.server_pools` и `core.endpoints`
5. Добавить `telemetry.network_fingerprints` и `telemetry.probe_reports`
6. Затем уже строить `analytics.route_success_rollups` и `analytics.route_rankings`

Текущий прогресс:

- `Prisma` уже добавлен в backend
- initial schema для `session`, `users`, `subscriptions`, `devices` уже зафиксирована
- auth foundation уже добавила `AuthSession`, `contactType` и `user status`
- initial SQL migration уже сгенерирована
- runtime backend уже работает только через `Prisma/PostgreSQL`
- `core.server_pools` и `core.endpoints` уже подняты в runtime
- `core.user_endpoint_assignments` уже тоже подняты в runtime
- `telemetry.network_fingerprints` и `telemetry.probe_reports` уже тоже подняты в runtime
- `analytics.route_success_rollups` и `analytics.route_rankings` уже тоже подняты в runtime

## Минимальный production MVP для БД

Если идти без лишнего перегруза, то первый обязательный набор таблиц такой:

- `core.users`
- `core.subscriptions`
- `core.devices`
- `core.server_pools`
- `core.endpoints`
- `telemetry.network_fingerprints`
- `telemetry.probe_reports`
- `ops.audit_logs`

Этого уже достаточно, чтобы:

- хранить клиентов отдельно
- хранить их устройства отдельно
- хранить server inventory отдельно
- принимать client reports отдельно
- не смешивать raw telemetry и account-данные
