#!/usr/bin/env bash
# Ручной деплой на несколько VPS БЕЗ GitHub/GHCR (у проекта пока нет git
# remote — .github/workflows/ci.yml нигде не выполняется). Копирует
# исходники на каждый хост из CP_HOSTS по rsync и собирает образы прямо там
# через deploy/compose.prod.yaml. Запускать локально, с машины, где есть
# rsync/ssh(/sshpass для password-auth) и доступ до всех хостов.
#
# Decision 042/043 (DECISIONS.md): раньше скрипт бил только в один
# VPS_IP — если хостов с control-plane несколько (сейчас их 2, см.
# project_dual_control_plane в памяти), деплой на второй забывали, и он
# отставал/оставался незащищённым дольше. Теперь CP_HOSTS — массив, скрипт
# деплоит на все хосты по очереди в одном запуске.
#
# Два разных .env-файла, оба локальные и в .gitignore:
#   deploy/ssh.env — массив CP_HOSTS (ip:user:password[:domain] на строку,
#                    см. deploy/ssh.env.example) — куда и как подключаться
#                    по ssh. На VPS не копируется (исключён из rsync ниже).
#   deploy/.env    — рантайм-секреты приложения (DATABASE_URL, POSTGRES_*,
#                    RESEND_API_KEY, CONTROL_PLANE_DOMAIN и т.д., см.
#                    backend/.env.example). Копируется на каждый VPS при
#                    каждом запуске, но CONTROL_PLANE_DOMAIN в копии на
#                    конкретном хосте переписывается на IP/domain ЭТОГО
#                    хоста (4-е поле в CP_HOSTS, либо сам ip, если поле не
#                    задано) — иначе TLS-сертификат каждого хоста будет на
#                    чужой домен/IP (см. Decision 040/041 — Caddy требует
#                    точного совпадения хоста в адресе сайта).
#
# Перед первым запуском на каждом VPS должен быть установлен Docker +
# compose plugin (см. deploy/README.md, get.docker.com).
#
# Запуск:
#   ./deploy/manual-deploy.sh
# (CP_HOSTS читается напрямую из deploy/ssh.env скриптом, source вручную
# делать не нужно)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SSH_ENV_FILE="deploy/ssh.env"
if [[ ! -f "$SSH_ENV_FILE" ]]; then
  echo "Нет ${SSH_ENV_FILE} — скопируй deploy/ssh.env.example и заполни CP_HOSTS" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SSH_ENV_FILE"

if [[ -z "${CP_HOSTS+x}" || ${#CP_HOSTS[@]} -eq 0 ]]; then
  echo "CP_HOSTS пуст или не задан массивом в ${SSH_ENV_FILE} — см. deploy/ssh.env.example" >&2
  exit 1
fi

DEPLOY_PATH="${DEPLOY_PATH:-/opt/simple-dimple}"

deploy_to_host() {
  local host_ip="$1" host_user="$2" host_password="$3" host_domain="$4"

  local ssh_cmd=(ssh -o StrictHostKeyChecking=no)
  local rsync_rsh=(ssh -o StrictHostKeyChecking=no)
  local run_ssh run_rsync
  if [[ -n "$host_password" ]]; then
    # Password-auth (текущий случай для обоих известных VPS — ssh-ключ не
    # заведён) — голый ssh/rsync не поддерживают non-interactive password,
    # нужен sshpass.
    if ! command -v sshpass >/dev/null 2>&1; then
      echo "sshpass не найден, но для ${host_ip} задан пароль — установи sshpass (brew install sshpass / apt install sshpass)" >&2
      return 1
    fi
    run_ssh() { SSHPASS="$host_password" sshpass -e "${ssh_cmd[@]}" "$@"; }
    run_rsync() { SSHPASS="$host_password" sshpass -e rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" "$@"; }
  else
    run_ssh() { "${ssh_cmd[@]}" "$@"; }
    run_rsync() { rsync -az --delete -e "ssh -o StrictHostKeyChecking=no" "$@"; }
  fi

  echo "==> [${host_ip}] Копирование исходников на VPS (${host_user}@${host_ip}:${DEPLOY_PATH})"
  run_rsync \
    --exclude '.git' \
    --exclude 'node_modules' \
    --exclude '**/node_modules' \
    --exclude '**/dist' \
    --exclude 'backend/data' \
    --exclude 'backend/.env' \
    --exclude 'backend/src/generated' \
    --exclude 'deploy/ssh.env' \
    --exclude 'deploy/.env' \
    ./ "${host_user}@${host_ip}:${DEPLOY_PATH}/"

  # CONTROL_PLANE_DOMAIN обязателен и должен совпадать с адресом ИМЕННО
  # этого хоста (Decision 040/041) — deploy/.env общий шаблон для всех
  # хостов, поэтому копия для каждого хоста собирается на лету с
  # подменённым значением, а не рассылается как есть.
  local tmp_env
  tmp_env="$(mktemp)"
  sed "s/^CONTROL_PLANE_DOMAIN=.*/CONTROL_PLANE_DOMAIN=\"${host_domain}\"/" deploy/.env > "$tmp_env"
  echo "==> [${host_ip}] Копирование deploy/.env (CONTROL_PLANE_DOMAIN=${host_domain})"
  run_rsync "$tmp_env" "${host_user}@${host_ip}:${DEPLOY_PATH}/deploy/.env"
  rm -f "$tmp_env"

  echo "==> [${host_ip}] Прогон миграций (одноразовый сервис migrate, profile tools)"
  # --build обязателен: "run" (в отличие от "up --build" ниже) НЕ
  # пересобирает образ сам по себе. Без --build здесь migrate тихо работает
  # на старом закешированном образе и не видит новые миграции, скопированные
  # rsync'ом только что — поймали это вживую 2026-07-09 (Decision 026).
  run_ssh "${host_user}@${host_ip}" "cd '${DEPLOY_PATH}' && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env --profile tools build migrate && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env --profile tools run --rm migrate"

  echo "==> [${host_ip}] Сборка и запуск backend/frontend/worker/postgres/caddy"
  run_ssh "${host_user}@${host_ip}" "cd '${DEPLOY_PATH}' && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env up --build -d"

  echo "==> [${host_ip}] Статус контейнеров"
  run_ssh "${host_user}@${host_ip}" "cd '${DEPLOY_PATH}' && docker compose -f deploy/compose.prod.yaml --env-file deploy/.env ps"

  echo "==> [${host_ip}] Готово. Проверь: curl -k https://${host_domain}/ — backend/frontend теперь только за caddy (TLS), голых :80/:8080 наружу больше нет"
}

FAILED_HOSTS=()
for entry in "${CP_HOSTS[@]}"; do
  IFS=':' read -r host_ip host_user host_password host_domain <<< "$entry"
  host_domain="${host_domain:-$host_ip}"
  echo
  echo "########## Хост: ${host_ip} (${host_domain}) ##########"
  if ! deploy_to_host "$host_ip" "$host_user" "$host_password" "$host_domain"; then
    echo "!!! Деплой на ${host_ip} упал — продолжаю с остальными хостами, но проверь этот вручную" >&2
    FAILED_HOSTS+=("$host_ip")
  fi
done

echo
if [[ ${#FAILED_HOSTS[@]} -gt 0 ]]; then
  echo "==> Готово с ошибками. Упавшие хосты: ${FAILED_HOSTS[*]}" >&2
  exit 1
fi
echo "==> Готово на всех хостах (${#CP_HOSTS[@]})."
