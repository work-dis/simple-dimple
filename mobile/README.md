# mobile — Capacitor Android shell (draft, не собирается)

Это черновой скелет для Этапа 2b из [../docs/PRIORITY_PLAN.md](../docs/PRIORITY_PLAN.md),
поднятый раньше срока из [../docs/ROADMAP.md, Этап 4](../docs/ROADMAP.md) — см.
[../docs/DECISIONS.md, Decision 021](../docs/DECISIONS.md) о том, почему PWA сама
не может держать VPN-туннель.

## Что здесь есть

- `capacitor.config.ts`, `package.json` — конфигурация Capacitor-проекта
  (`webDir: "../frontend/dist"` — Capacitor бандлит уже существующую PWA-сборку,
  не отдельный код)
- `android-skeleton/VpnTunnelPlugin.kt` — набросок Android-стороны плагина поверх
  `android.net.VpnService`. Это **не рабочий код** (не компилировался и не
  собирался — нет `android/`-проекта, см. ниже), но уже не только `TODO`:
  `connect()` парсит `config.params` из `ConnectionConfigSummary`, правильно
  реализует `VpnService.prepare()` consent-flow через Capacitor
  `startActivityForResult`/`@ActivityCallback`, и валидирует обязательные поля
  до попытки поднять что-либо. Реальный вызов Xray core внутри `startTunnel()`
  и сам `SimpleDimpleVpnService` оставлены как `TODO` — это осознанно, см. ниже

## Где живёт JS-сторона плагина

**Не здесь.** `frontend/src/lib/vpnTunnel.ts` — потому что Capacitor бандлит
`frontend/dist` как `webDir` (см. `capacitor.config.ts` выше), значит именно
frontend-код реально попадает в нативную оболочку и вызывает
`registerPlugin("VpnTunnel")`. `mobile/` держит только Capacitor-проект и
нативный Kotlin-скелет — держать здесь ещё одну копию TS-интерфейса было бы
дублированием источника истины.

`frontend/src/hooks/useRouteSession.ts` уже подключает это к экрану
подключения: `toggleConnection()` и `changeServer()` после успешного
`POST /api/connect`/`POST /api/server` вызывают `connectNativeTunnel(config)`/
`disconnectNativeTunnel()` из `frontend/src/lib/vpnTunnel.ts`, но только если
`isNativeTunnelAvailable()` (`Capacitor.isNativePlatform()`) — в браузерной PWA
это всегда `false`, так что существующий browser-only flow не затронут. Backend
`session.status` остаётся источником истины (Decision 021); нативный вызов —
best-effort side effect, его ошибка не ломает основной connect/disconnect flow,
а идёт в `onError` с префиксом `Native VPN tunnel:`.

## Что здесь специально не сделано и почему

- не запускался `npx cap add android` — это создаёт полноценный Gradle-проект и
  требует Android SDK/Gradle wrapper, которых нет в среде, где собирался этот
  черновик; результат было бы невозможно ни собрать, ни проверить (проверено:
  `adb`/`sdkmanager`/`gradle` в этом окружении отсутствуют)
- `npm install` в этой папке не выполнялся — Capacitor-пакеты не установлены
  (в отличие от `frontend/`, куда `@capacitor/core` уже добавлен как реальная
  зависимость — она нужна там для JS-стороны плагина и безопасна в браузере)
- нет реальной сборки `xray-core` под Android (`.so`/AAR) — выбор конкретной
  библиотеки/подхода (JNI `.so` vs готовый AAR) осознанно не сделан в этом
  черновике: это отдельное архитектурное решение, а не деталь реализации
  `VpnTunnelPlugin.kt`
- `mobile` **не добавлен** в `workspaces` корневого `package.json` — черновик не
  должен участвовать в `npm install`/`npm run build`/`npm run check` для
  backend+frontend
- `VpnTunnelPlugin.kt` не компилировался и не тайпчекался Kotlin/Gradle-тулингом
  (его нет в этой среде) — API Capacitor Android bridge (`Plugin`, `PluginCall`,
  `JSObject`, `startActivityForResult`/`@ActivityCallback`) использованы по
  памяти о стабильном публичном контракте, но код нужно прогнать через реальный
  `android/`-проект при первой возможности, прежде чем на него полагаться

## Что нужно сделать в первую очередь, когда появится Android-тулинг

1. `cd mobile && npm install`
2. `npx cap init` (или donor `capacitor.config.ts` уже здесь) → `npx cap add android`
3. Скопировать `android-skeleton/VpnTunnelPlugin.kt` в
   `android/app/src/main/java/com/simpledimple/app/VpnTunnelPlugin.kt`, собрать
   и убедиться, что он вообще компилируется — первая реальная проверка API,
   использованных вслепую
4. Подключить реальный Xray core для Android (mobile-сборка `xray-core`, обычно как
   `.so` через JNI, либо готовый AAR вроде `libXray`) и реализовать `startTunnel()`/
   `SimpleDimpleVpnService` поверх него
5. ~~Подключить `vpn-tunnel.ts` к экрану подключения во frontend~~ — уже сделано:
   `frontend/src/lib/vpnTunnel.ts` + `frontend/src/hooks/useRouteSession.ts`
6. Ручная проверка на реальном устройстве/эмуляторе: публичный IP меняется, трафик
   реально идёт через туннель
