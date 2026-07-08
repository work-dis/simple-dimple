# mobile — Capacitor Android shell (draft, не собирается)

Это черновой скелет для Этапа 2b из [../docs/PRIORITY_PLAN.md](../docs/PRIORITY_PLAN.md),
поднятый раньше срока из [../docs/ROADMAP.md, Этап 4](../docs/ROADMAP.md) — см.
[../docs/DECISIONS.md, Decision 021](../docs/DECISIONS.md) о том, почему PWA сама
не может держать VPN-туннель.

## Что здесь есть

- `capacitor.config.ts`, `package.json` — конфигурация Capacitor-проекта
- `src/plugins/vpn-tunnel.ts` — TS-интерфейс плагина, которым UI будет запускать/
  останавливать туннель (`connect(config)`/`disconnect()`/`status()`), где `config`
  — это `connectionConfig`, который уже отдаёт backend (`POST /api/connect`,
  `POST /api/routes/resolve`)
- `android-skeleton/VpnTunnelPlugin.kt` — набросок Android-стороны плагина поверх
  `android.net.VpnService`; это **не рабочий код**, а структура с `TODO`, показывающая
  где будет жить запуск локального Xray core и поднятие туннеля

## Что здесь специально не сделано и почему

- не запускался `npx cap add android` — это создаёт полноценный Gradle-проект и
  требует Android SDK/Gradle wrapper, которых нет в среде, где собирался этот
  черновик; результат было бы невозможно ни собрать, ни проверить
- `npm install` в этой папке не выполнялся — Capacitor-пакеты не установлены
- нет реальной сборки `xray-core` под Android (`.so`/AAR) — это отдельная задача,
  делать её вслепую без возможности собрать APK и протестировать на устройстве
  большого смысла не имеет
- `mobile` **не добавлен** в `workspaces` корневого `package.json` — черновик не
  должен участвовать в `npm install`/`npm run build`/`npm run check` для
  backend+frontend

## Что нужно сделать в первую очередь, когда появится Android-тулинг

1. `cd mobile && npm install`
2. `npx cap init` (или donor `capacitor.config.ts` уже здесь) → `npx cap add android`
3. Подключить реальный Xray core для Android (mobile-сборка `xray-core`, обычно как
   `.so` через JNI, либо готовый AAR вроде `libXray`)
4. Реализовать `VpnTunnelPlugin.kt` поверх `android.net.VpnService`: получить
   `connectionConfig` от backend → передать его в Xray core → поднять `TUN`
5. Подключить `src/plugins/vpn-tunnel.ts` к экрану подключения во frontend (кнопка
   "Подключить" сейчас дергает только `POST /api/connect`, реальный вызов туннеля
   предстоит добавить)
6. Ручная проверка на реальном устройстве/эмуляторе: публичный IP меняется, трафик
   реально идёт через туннель
