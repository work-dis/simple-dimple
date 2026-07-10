# Deploy

Шаг 4 из [../docs/PRIORITY_PLAN.md](../docs/PRIORITY_PLAN.md). Этот каталог
описывает деплой приложения (backend/frontend/worker), не путать с
[xray/](xray/) — там dev-инбаунд для реального VPN-транспорта (Шаг 2).

**У проекта сейчас нет GitHub-репозитория (`git remote` пуст)** — секция
`.github/workflows/ci.yml` ниже не выполняется нигде и не может, пока
удалённый репозиторий не заведён. Актуальный рабочий путь — ручной деплой
через [`manual-deploy.sh`](manual-deploy.sh): он копирует исходники на VPS по
rsync и собирает образы прямо там, GHCR/registry вообще не участвует.
`compose.prod.yaml` написан так, что позже, если появится GitHub, тот же
файл заработает и в CI-режиме (pull готовых образов вместо build) — но это
отдельный шаг на будущее, не нужный для ручного теста сейчас.

## Что уже есть

- [`../backend/Dockerfile`](../backend/Dockerfile) — образ backend/worker
  (один образ, разный `CMD`)
- [`../frontend/Dockerfile`](../frontend/Dockerfile) + [`nginx/frontend.conf`](nginx/frontend.conf) — образ frontend (статика + reverse proxy на `/api`)
- [`Caddyfile`](Caddyfile) — TLS-терминатор control-plane (Decision 039,
  DECISIONS.md): единственный сервис с портами наружу (`:80`/`:443`),
  получает сертификат Let's Encrypt по домену и проксирует на `frontend`
  внутри docker-сети. `frontend`/`backend` больше не публикуют портов
  наружу напрямую — до этого пароли, OTP-коды и `x-auth-session-id` ходили
  голым HTTP.
- [`compose.prod.yaml`](compose.prod.yaml) — compose-файл целевого сервера:
  умеет и собирать образы на месте (`up --build`, текущий путь без GitHub),
  и тянуть готовые из GHCR (`pull`, если позже заработает CI)
- [`manual-deploy.sh`](manual-deploy.sh) — rsync исходников + миграции +
  `up --build -d` на КАЖДЫЙ хост из `CP_HOSTS` (`deploy/ssh.env`) за один
  запуск (Decision 043, DECISIONS.md), без GitHub/GHCR
- `../compose.yaml`, profile `prod` — тот же билд, но для локального
  smoke-теста на своей машине: `docker compose --profile prod up --build`
- `.github/workflows/ci.yml`, job'ы `deploy-staging`/`deploy-prod` — на
  будущее, когда появится GitHub-репозиторий и заведутся secrets ниже

**Ничего из этого не проверялось на реальном Docker в этой сессии** —
писалось в песочнице без Docker. Прежде чем полагаться на это в реальном
деплое:
`docker compose --profile prod up --build` локально с реальным Docker,
проверить, что backend/frontend реально стартуют и отвечают.

## Два .env, оба локальные и в .gitignore

- **`deploy/ssh.env`** — массив `CP_HOSTS` (одна строка на VPS,
  `"ip:user:password[:domain]"`, см. [`ssh.env.example`](ssh.env.example))
  — только для ssh-доступа с твоей машины. На VPS никогда не копируется.
  `manual-deploy.sh` проходит по ВСЕМ хостам из этого массива за один
  запуск (Decision 043) — добавить новый control-plane VPS = добавить одну
  строку сюда, без правок скрипта.
- **`deploy/.env`** — рантайм-секреты приложения: `DATABASE_URL` (указывает на
  сервис `postgres` из `compose.prod.yaml`, не `localhost`), `POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`POSTGRES_DB`, `RESEND_API_KEY`,
  `OPS_ALERT_TELEGRAM_BOT_TOKEN`, `CORS_ALLOWED_ORIGINS`,
  `CONTROL_PLANE_DOMAIN`/`ACME_EMAIL` (TLS, см. ниже) и т.д. (см.
  `backend/.env.example`). Уже создан с дефолтами, совпадающими с локальной
  разработкой (`simpledimple`/`change-me`/`simple_dimple`) — при желании
  поменяй `POSTGRES_PASSWORD` на что-то не `change-me`. **Отдельно на VPS
  создавать не нужно** — `manual-deploy.sh` копирует этот файл на каждый
  сервер сам, но переписывает `CONTROL_PLANE_DOMAIN` в отправляемой копии
  под IP/домен конкретного хоста (4-е поле в `CP_HOSTS`, либо сам ip) —
  значение в локальном `deploy/.env` на диске не трогается, это просто
  шаблон.

## TLS (нужно один раз, до первого запуска `manual-deploy.sh`)

`caddy` (см. [`Caddyfile`](Caddyfile)) — единственный контейнер, публикующий
`:80`/`:443` наружу, и терминирует TLS перед `frontend`/`backend` (Decision
039/040, `../docs/DECISIONS.md`). `CONTROL_PLANE_DOMAIN` в `deploy/.env`
обязателен всегда (домен ИЛИ голый IP VPS) — два режима, переключаются
`ACME_EMAIL`:

- **без домена (по умолчанию)** — `CONTROL_PLANE_DOMAIN=<IP этого VPS>`,
  `ACME_EMAIL` закомментирован → `tls internal`: caddy сам выпускает
  самоподписанный сертификат, работает сразу после `up`, без DNS. Браузер
  покажет предупреждение "небезопасное соединение" на первом заходе —
  ожидаемо для self-signed, нужно явно принять исключение. Проверено вживую
  локальным Docker (Decision 040) — рабочий путь для staging/теста без
  домена;
- **с настоящим Let's Encrypt** — `CONTROL_PLANE_DOMAIN=<реальный домен>` с
  A-записью на IP этого VPS (ДО первого `up`, иначе ACME HTTP-01 challenge
  не пройдёт), `ACME_EMAIL` раскомментирован и заполнен. Открытые наружу
  `:80` (сам challenge) и `:443` нужны — обычно уже так, если фаервол не
  режет 80/443 отдельно от прочих портов. Не проверено вживую на реальном
  VPS в этой сессии — нужен настоящий публичный DNS.

Если `caddy` не поднимается — проверить `docker compose -f
deploy/compose.prod.yaml --env-file .env logs caddy` на VPS (в режиме
Let's Encrypt без валидного DNS уйдёт в crash-loop "no certificate
available"; в режиме `tls internal` без явного хоста в `CONTROL_PLANE_DOMAIN`
роняет TLS handshake на любое соединение — см. Decision 040 для деталей).

## Настройка VPS (нужно один раз, до первого запуска `manual-deploy.sh`)

Docker + compose plugin на VPS нужно поставить заранее:
`docker-compose-plugin` есть только в официальном репозитории Docker, не в
дефолтных репах Ubuntu — `apt install docker.io docker-compose-plugin` падает
с "Unable to locate package". Ставить официальным скриптом:

```
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER   # чтобы docker compose работал без sudo
# и перелогиниться (exit, зайти по ssh заново) — группа применяется к новой сессии
```

`mkdir -p /opt/simple-dimple` на VPS создавать не нужно — `manual-deploy.sh`
сам создаст путь через rsync.

После этого с локальной машины:

```
./deploy/manual-deploy.sh
```

Деплоит на все хосты из `CP_HOSTS` (`deploy/ssh.env`) по очереди за один
запуск (`source` вручную делать не нужно — скрипт сам читает
`deploy/ssh.env`). Если хотя бы один хост упал — скрипт продолжает с
остальными и в конце печатает список упавших с ненулевым exit code.

Для password-auth (как у обоих текущих VPS — ssh-ключ не заведён) нужен
`sshpass` на локальной машине (`brew install sshpass` / `apt install
sshpass`); если у хоста в `CP_HOSTS` пароль не задан — используется обычный
ssh-ключ/agent, без sshpass.

(`docker login ghcr.io` не нужен — образы собираются на VPS из исходников, не тянутся из registry).

## (На будущее, неактуально без git remote) Что нужно настроить в GitHub, чтобы CI-деплой заработал

Deploy-job'ы написаны так, что без секретов ниже они просто падают на первом
шаге, которому нужен секрет — ничего не разворачивают вслепую.

### 1. Environments (Settings -> Environments)

- `staging` — без защиты, деплоится на каждый push в `main` после зелёного CI
- `prod` — с **required reviewers** (это единственное место, где заводится
  ручной approve перед прод-деплоем; из кода/CI это не настраивается),
  деплоится на git-тег `vX.Y.Z`

### 2. Secrets (per-environment, Settings -> Environments -> `<env>` -> Secrets)

| Secret | Что это |
| --- | --- |
| `STAGING_DATABASE_URL` / `PROD_DATABASE_URL` | `postgresql://...` для `prisma migrate deploy` перед деплоем |
| `STAGING_SSH_HOST` / `PROD_SSH_HOST` | адрес VPS |
| `STAGING_SSH_USER` / `PROD_SSH_USER` | ssh-пользователь на VPS |
| `STAGING_SSH_KEY` / `PROD_SSH_KEY` | приватный ssh-ключ (deploy-only, не личный) |
| `STAGING_DEPLOY_PATH` / `PROD_DEPLOY_PATH` | путь на VPS, где лежит `compose.prod.yaml` и `.env` с рантайм-секретами (`DATABASE_URL`, `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`, `RESEND_API_KEY`, `OPS_ALERT_TELEGRAM_BOT_TOKEN`, `CORS_ALLOWED_ORIGINS` и т.д. — см. `backend/.env.example`) |

`GITHUB_TOKEN` для push в `ghcr.io` ничего заводить не нужно — это
встроенный токен Actions, job уже просит `permissions: packages: write`.

## Известные пробелы (сознательно не закрыты в этом проходе)

- Postgres теперь поднимается прямо в `compose.prod.yaml` (сервис `postgres`,
  как в корневом `compose.yaml`) — годится для single-host staging/ручного
  теста. Для настоящего prod с managed БД удали сервис `postgres` и
  `depends_on` на него, а `DATABASE_URL` в `.env` направь на внешний инстанс.
- нет health-check/rollback шага после `docker compose up -d` — если новый
  образ не стартует, CI всё равно зелёный
- `npm ci --omit=dev` в `backend/Dockerfile` ставит prod-зависимости для
  **всех** workspace'ов разом (общий lockfile) — образ backend тащит и
  frontend-зависимости; для этого масштаба проекта не критично, но не оптимально
