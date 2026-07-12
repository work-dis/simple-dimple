#!/usr/bin/env bash
# Синкает только deploy/xray/*.sh (provision-node.sh, sync-clients.sh, ...) на
# xray-only ноды — хосты, которые крутят xray-core + cron sync-clients.sh, но
# НЕ приложение (backend/frontend/worker/postgres/caddy).
#
# Зачем отдельный скрипт, а не manual-deploy.sh: manual-deploy.sh (CP_HOSTS)
# рассинхронизирует весь репозиторий И пересобирает/перезапускает docker
# compose control-plane — на чистой xray-ноде (см. Decision 050,
# DECISIONS.md: 167.86.77.100 понижен до pure xray node, control-plane там
# снесён) это случайно подняло бы control-plane обратно. До этого скрипта
# обновление sync-clients.sh на такой ноде было ручным scp-шагом, который
# легко забыть (см. Decision 055/056) — этот скрипт делает его одной
# командой, симметрично manual-deploy.sh, но НЕ трогает docker compose и не
# рассинхронизирует остальной репозиторий.
#
# Запуск:
#   ./deploy/xray/sync-node-scripts.sh
# (XRAY_ONLY_HOSTS читается напрямую из deploy/ssh.env, см.
# ssh.env.example — source вручную делать не нужно)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

SSH_ENV_FILE="deploy/ssh.env"
if [[ ! -f "$SSH_ENV_FILE" ]]; then
  echo "Нет ${SSH_ENV_FILE} — скопируй deploy/ssh.env.example и заполни XRAY_ONLY_HOSTS" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SSH_ENV_FILE"

if [[ -z "${XRAY_ONLY_HOSTS+x}" || ${#XRAY_ONLY_HOSTS[@]} -eq 0 ]]; then
  echo "XRAY_ONLY_HOSTS пуст или не задан массивом в ${SSH_ENV_FILE} — синкать некуда, выходим без ошибки"
  exit 0
fi

DEPLOY_PATH="${DEPLOY_PATH:-/opt/simple-dimple}"

sync_to_host() {
  local host_ip="$1" host_user="$2" host_password="$3"

  local run_ssh run_rsync
  if [[ -n "$host_password" ]]; then
    if ! command -v sshpass >/dev/null 2>&1; then
      echo "sshpass не найден, но для ${host_ip} задан пароль — установи sshpass (brew install sshpass / apt install sshpass)" >&2
      return 1
    fi
    run_ssh() { SSHPASS="$host_password" sshpass -e ssh -o StrictHostKeyChecking=no "$@"; }
    run_rsync() { SSHPASS="$host_password" sshpass -e rsync -az -e "ssh -o StrictHostKeyChecking=no" "$@"; }
  else
    run_ssh() { ssh -o StrictHostKeyChecking=no "$@"; }
    run_rsync() { rsync -az -e "ssh -o StrictHostKeyChecking=no" "$@"; }
  fi

  echo "==> [${host_ip}] Убеждаюсь, что ${DEPLOY_PATH}/deploy/xray существует"
  run_ssh "${host_user}@${host_ip}" "mkdir -p '${DEPLOY_PATH}/deploy/xray'"

  echo "==> [${host_ip}] Синк deploy/xray/*.sh (${host_user}@${host_ip}:${DEPLOY_PATH}/deploy/xray/)"
  # Только *.sh — не вся deploy/xray/ директория: dev-config*.json на ноде
  # может быть per-node артефактом провижининга, его трогать не нужно.
  # rsync -a сохраняет права (бит исполнения) как есть с локальной машины —
  # тот же класс бага, что чинили в Decision 045 (потерянный chmod +x при
  # копировании), больше не должен повториться.
  run_rsync deploy/xray/*.sh "${host_user}@${host_ip}:${DEPLOY_PATH}/deploy/xray/"

  echo "==> [${host_ip}] Готово."
}

FAILED_HOSTS=()
for entry in "${XRAY_ONLY_HOSTS[@]}"; do
  IFS=':' read -r host_ip host_user host_password <<< "$entry"
  echo
  echo "########## xray-only хост: ${host_ip} ##########"
  if ! sync_to_host "$host_ip" "$host_user" "$host_password"; then
    echo "!!! Синк на ${host_ip} упал — проверь вручную" >&2
    FAILED_HOSTS+=("$host_ip")
  fi
done

echo
if [[ ${#FAILED_HOSTS[@]} -gt 0 ]]; then
  echo "==> Готово с ошибками. Упавшие хосты: ${FAILED_HOSTS[*]}" >&2
  exit 1
fi
echo "==> Готово на всех xray-only хостах (${#XRAY_ONLY_HOSTS[@]})."
