# Code Review

Результаты ревью кода — критические баги, проблемы с архитектурой и мелкие замечания.

## Как обновлять

Новая запись добавляется, когда:
- обнаружена **критическая проблема** (race condition, потеря данных, уязвимость)
- найдена **логическая ошибка**, которая может сломать поведение
- выявлено **расхождение контрактов** (типы, API, данные)

Мелкие замечания (стиль, naming, тупой код) не документируем — они идут в PR.

---

## Review 001

Дата: `2026-07-07`
Проверял: Hermes Agent (deepseek-v4-flash)
Объём проверки: backend (server.ts, store/, route-policy.ts), frontend (App.tsx, hooks/, lib/, components/), Prisma schema, документация

### 🚨 Critical

| # | Проблема | Файл | Что именно | Статус |
|---|----------|------|------------|--------|
| 1 | **Race condition на глобальном `state`** | `backend/src/server.ts:45` | `const state = persistedState.session` — module-level объект без блокировки. Два конкурентных запроса к `/api/connect` или `/api/server` могут одновременно читать и писать `state.status`, `state.activeServerId`, `state.connectCount`. | ✅ Fixed — добавлен `withStateLock()` (promise-chain mutex), обёрнуты `/api/connect`, `/api/server`, `PATCH /api/account/profile` |

### ⚠️ Medium

| # | Проблема | Файл | Что именно | Статус |
|---|----------|------|------------|--------|
| 1 | **Мёртвый код: дубликат `return`** | `frontend/src/App.tsx:75-76` | Два `return;` подряд. Второй statement никогда не выполнится. | ✅ Fixed — удалён дубликат |
| 2 | **Probe reports без идентификации клиента** | `frontend/src/lib/network.ts:28-45` | `submitProbeReport()` шлёт fetch() без заголовка `x-auth-session-id`. На бэкенде userId=null, телеметрия не привязана к клиенту. | ✅ Fixed — добавлен `x-auth-session-id` в headers probe-запросов через динамический импорт `getStoredAuthSessionId()` |
| 3 | **Тип `TelemetryNetworkContext` на фронтенде уже, чем требуется** | `frontend/types/route.ts:93-95` | Фронтенд шлёт только `networkType: string`, но Prisma-схема и store ожидают опциональные `carrier`, `asn`, `countryCode`, `region`. | ✅ Fixed — тип расширен до полного контракта; `buildRouteContext()` собирает `networkType` + `carrier`; остальные поля добавляются по мере появления API браузера |
| 4 | **`seedDefaultData()` не вызывается после рефакторинга** | `backend/src/store/state-store.ts` | В DECISIONS.md (Decision 014) написано, что seed вынесен в конструктор store. В коде вызова нет — демо-данные живут только в миграциях. | ❌ Не фикс — код был рефакторирован, seed удалён осознанно. Документация устарела (см. CODE_REVIEW.md). |
| 5 | **Ответ `/api/connect` не возвращает `servers`, хотя тип `SessionResponse` его декларирует** | `backend/src/server.ts:956-961` | Контракт типа `SessionResponse` включает `servers`, но реальный ответ его не содержит. Фронтенд, к счастью, не читает это поле — но тип врёт. | ✅ Fixed — `SessionResponse.servers` сделан `optional`, `setServers()` читает `data.servers ?? []` |

### 🟢 Minor

| # | Проблема | Файл | Что именно | Статус |
|---|----------|------|------------|--------|
| 1 | `TelemetryNetworkContext` на фронтенде редуцирован | `frontend/types/route.ts` | Только `networkType`. Для dev допустимо, но перед релизом нужно расширить. | ✅ Fixed — расширен (см. Medium #3) |

### Детали по найденным проблемам

#### Race condition (Critical #1)

```ts
// server.ts:45
const state = persistedState.session; // обычный JS-объект, module-level
```

Сценарий:
1. Запрос A: `state.status = "disconnected"` → меняет на `"connected"`, `connectCount++`
2. Запрос B (одновременно): тоже видит `"disconnected"` → тоже меняет на `"connected"`, ещё раз `connectCount++`
3. Итог: два "подключения", счётчик сбит, состояние расходится с БД

Fix: обёрнут мутации `state` в promise-chain mutex (`withStateLock()`), сериализует записи `/api/connect`, `/api/server`, `PATCH /api/account/profile`.

#### Probe reports без auth (Medium #2)

`submitProbeReport()` в `network.ts` не слал `x-auth-session-id`. На бэкенде это приводило к записи `userId: null` в `ProbeReport`.

Fix: динамический импорт `getStoredAuthSessionId()` из `./http`, добавление в headers probe-запроса.

### Что хорошо

- **Форматтеры** (`formatters.ts`) — полный набор assignment reasons, failure reasons, alert severities
- **Auth-флоу** — `useAuthAccount` → `/api/auth/*` → `auth.ts` store → Prisma — всё сходится
- **Policy engine** — `route-policy.ts` → `runtime.ts` → `server.ts` — замкнуто
- **Ops-алерты** — детектор → persisted alerts → UI — цепочка работает
- **Тесты** — ranking, route-reprobe, ops-alerts, route-decision-ops — есть, базово покрывают
- **Типы провязаны от Prisma через store → runtime → API → frontend hooks → компоненты**
