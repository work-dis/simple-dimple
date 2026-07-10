# mobile — Capacitor Android shell (собирается; туннель ещё не проверен на устройстве)

Это скелет для Этапа 2b из [../docs/PRIORITY_PLAN.md](../docs/PRIORITY_PLAN.md),
поднятый раньше срока из [../docs/ROADMAP.md, Этап 4](../docs/ROADMAP.md) — см.
[../docs/DECISIONS.md, Decision 021](../docs/DECISIONS.md) о том, почему PWA сама
не может держать VPN-туннель.

**Статус (2026-07-09):** `startTunnel()`/`SimpleDimpleVpnService` реализованы
поверх `XTLS/libXray` (gomobile-сборка Xray-core под Android), `./gradlew
:app:assembleDebug` собирает APK с реально влинкованным `libgojni.so` под все
4 ABI. Подробности — [../docs/DECISIONS.md, Decision 029](../docs/DECISIONS.md).
**Не проверено:** реальный запуск на устройстве/эмуляторе — не создан Android
Virtual Device, поднятие туннеля физически не подтверждено (только
`BUILD SUCCESSFUL`).

## Архитектура туннеля

Xray-core умеет читать/писать TUN-интерфейс напрямую через встроенный `tun`
inbound (gVisor-based userspace network stack,
[proxy/tun/README.md](https://github.com/XTLS/Xray-core/blob/main/proxy/tun/README.md)) —
отдельный tun2socks-мост (hev-socks5-tunnel и т.п.) не нужен:

1. `VpnService.Builder.establish()` в `SimpleDimpleVpnService` поднимает TUN,
   отдаёт `ParcelFileDescriptor`.
2. `LibXray.setTunFd(pfd.fd)` — Xray-core заберёт этот fd через env
   `xray.tun.fd` при старте.
3. Xray JSON-конфиг (собирается в `VpnTunnelPlugin.buildXrayConfig()` из
   `tunnelParams`) содержит один inbound `protocol: "tun"` и один outbound
   `protocol: "vless"` со `streamSettings.security: "reality"` — без явных
   routing-правил, единственный outbound используется по умолчанию.
4. `LibXray.runXrayFromJSON(...)` стартует Xray-core с этим конфигом и уже
   выставленным `tun.fd`.
5. `LibXray.stopXray()` останавливает инстанс, `disconnect()` дополнительно
   закрывает `ParcelFileDescriptor`.

## Как собрать `libXray.aar` (нужно один раз, редко меняется)

`libXray.aar` **не коммитится** в репозиторий (>90MB, машинно-специфичен) —
собирается локально через `gomobile bind` и живёт в
`mobile/android/app/libs/libXray.aar` (см. `.gitignore`). Пересобирать нужно
только при обновлении версии Xray-core/libXray.

```
# тулинг для сборки .aar (один раз)
brew install go
go install golang.org/x/mobile/cmd/gomobile@latest
export PATH="$HOME/go/bin:$PATH"

export JAVA_HOME=/opt/homebrew/opt/openjdk@21
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export ANDROID_NDK_HOME=/opt/homebrew/share/android-commandlinetools/ndk/28.2.13676358
sdkmanager "ndk;28.2.13676358"   # если ещё не стоит

mkdir -p mobile/native-libs && cd mobile/native-libs
git clone --depth 1 --branch v26.6.27 https://github.com/XTLS/libXray.git
cd libXray
python3 build/main.py android
# результат: libXray.aar, libXray-sources.jar в mobile/native-libs/libXray/

cp libXray.aar ../../android/app/libs/libXray.aar
```

Пин версии (`v26.6.27`) — тот же тег, что `libXray`'s `build.py` использует
по умолчанию для `xray-core` (`DEFAULT_XRAY_CORE_TAG`). Обновлять оба вместе,
не по отдельности.

**API `libXray.aar`** (пакет `libXray`, класс `LibXray` — статические
методы, не JSON-dispatcher `Invoke()` из `main`-ветки репозитория, у пинного
тега `v26.6.27` API проще):

- `setTunFd(fd: Int)` — до `runXray`/`runXrayFromJSON`
- `newXrayRunFromJSONRequest(datDir, configJSON): String` — собирает
  base64-запрос
- `runXrayFromJSON(base64Request): String` — возвращает base64
  `{success, data, error}`
- `stopXray(): String`, `getXrayState(): Boolean`, `xrayVersion(): String`

## Как собрать APK локально

```
export JAVA_HOME=/opt/homebrew/opt/openjdk@21   # именно 21 — см. ниже, почему
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

cd mobile
npm install
npx cap add android   # только если android/ ещё не существует
cp android-skeleton/VpnTunnelPlugin.kt android-skeleton/SimpleDimpleVpnService.kt \
  android/app/src/main/java/com/simpledimple/app/
# libXray.aar должен уже лежать в android/app/libs/ — см. секцию выше

cd android
./gradlew :app:assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk (~200MB debug,
# несжатые libgojni.so под все 4 ABI — для release нужен ABI split/App Bundle)
```

Установка Android-тулинга (если его нет в системе):

```
brew install gradle
brew install --cask android-commandlinetools
brew install openjdk@21
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0"
```

**Почему именно JDK 21, а не новее**: перебраны 3 версии — `openjdk@17` не
хватает (`capacitor-android` требует `--release 21`), `openjdk@26` слишком
новый (`jlink`/`androidJdkImage`-трансформация Android Gradle Plugin 8.7.2
ломается на нём). Это ограничение текущей версии AGP в проекте, не общее
правило. Подробности — Decision 028.

## Что здесь есть

- `capacitor.config.ts`, `package.json` — конфигурация Capacitor-проекта
  (`webDir: "../frontend/dist"` — Capacitor бандлит уже существующую PWA-сборку,
  не отдельный код)
- `android-skeleton/VpnTunnelPlugin.kt` — источник истины для Android-стороны
  плагина поверх `android.net.VpnService`. `connect()` парсит `config.params`
  из `ConnectionConfigSummary`, реализует `VpnService.prepare()`
  consent-flow через Capacitor `startActivityForResult`/`@ActivityCallback`,
  валидирует обязательные поля, собирает Xray JSON-конфиг
  (`buildXrayConfig()`) и запускает `SimpleDimpleVpnService` через `Intent`.
  `disconnect()`/`status()` аналогично
- `android-skeleton/SimpleDimpleVpnService.kt` — источник истины для
  `android.net.VpnService`: поднимает TUN (`Builder.establish()`), передаёт
  fd в `LibXray.setTunFd()`, стартует/останавливает Xray через
  `LibXray.runXrayFromJSON()`/`stopXray()`, держит foreground-уведомление
  (обязательно для VPN-сервисов на современном Android)
- Оба файла копируются в `android/app/src/...` вручную (см. команду выше) —
  `android/` регенерируется командой `cap add android` и не должен
  расходиться с этими файлами как единственным источником
- `android/` — сгенерированный `npx cap add android` Gradle-проект. Build-
  артефакты (`build/`, `.gradle/`, `local.properties`) игнорируются
  собственным `android/.gitignore` (стандартный Android-шаблон);
  `android/app/libs/*.aar` игнорируется корневым `.gitignore`
- `native-libs/` — рабочая директория для сборки `libXray.aar` (git-клон
  `XTLS/libXray` + build-артефакты), полностью в `.gitignore`, регенерируется
  по команде выше

## Где живёт JS-сторона плагина

**Не здесь.** `frontend/src/lib/vpnTunnel.ts` — потому что Capacitor бандлит
`frontend/dist` как `webDir` (см. `capacitor.config.ts` выше), значит именно
frontend-код реально попадает в нативную оболочку и вызывает
`registerPlugin("VpnTunnel")`. `mobile/` держит только Capacitor-проект и
нативный Kotlin-код — держать здесь ещё одну копию TS-интерфейса было бы
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

Плагин зарегистрирован в `android/app/src/main/java/com/simpledimple/app/MainActivity.java`
через `registerPlugin(VpnTunnelPlugin.class)` — без этого Capacitor не находит
плагин по имени `"VpnTunnel"` в рантайме.

## Что здесь по-прежнему не сделано и почему

- **не проверено на реальном устройстве/эмуляторе** — единственный
  оставшийся пункт Definition of done Шага 2b. `avdmanager` доступен через
  `android-commandlinetools`, AVD ещё не создан. До этой проверки
  `startTunnel()` — рабочий по компиляции и по документированному Xray-core
  API код, но не подтверждённый вживую (публичный IP не проверялся)
- APK debug-сборки ~200MB (нестрипнутые `libgojni.so` под 4 ABI, Gradle сам
  предупреждает `Unable to strip the following libraries`) — для реального
  распространения нужен ABI split или Android App Bundle, чтобы конечный
  APK/AAB на одно устройство не тянул все архитектуры разом
- нет geo-данных (`geosite.dat`/`geoip.dat`) — сознательно: конфиг не
  использует domain/geoip routing-правила (один outbound, всё через него по
  умолчанию), значит они не нужны. Если появится routing по доменам —
  понадобится `LibXray.countGeoData`/`readGeoFiles` и сами `.dat`-файлы
- `mobile` **не добавлен** в `workspaces` корневого `package.json` — этот
  проект не должен участвовать в `npm install`/`npm run build`/`npm run check`
  для backend+frontend

## Что нужно сделать в первую очередь

1. ~~`cd mobile && npm install`~~ — сделано
2. ~~`npx cap add android`~~ — сделано
3. ~~Скопировать `VpnTunnelPlugin.kt`, собрать, убедиться, что компилируется~~ —
   сделано, `BUILD SUCCESSFUL`
4. ~~Подключить реальный Xray core для Android и реализовать
   `startTunnel()`/`SimpleDimpleVpnService`~~ — сделано через `libXray`
   (gomobile AAR), `BUILD SUCCESSFUL` с реально влинкованным `libgojni.so`
5. ~~Подключить `vpn-tunnel.ts` к экрану подключения во frontend~~ — уже сделано:
   `frontend/src/lib/vpnTunnel.ts` + `frontend/src/hooks/useRouteSession.ts`
6. **Следующий шаг**: ручная проверка на реальном устройстве/эмуляторе —
   публичный IP меняется, трафик реально идёт через туннель. Нужен `adb
   install app-debug.apk` на реальном устройстве (эмулятор с Google APIs
   может не поддерживать `VpnService` корректно) с реальным
   `connectionConfig` от backend (Шаг 2a)
