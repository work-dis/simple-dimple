#!/usr/bin/env bash
#
# Периодическая синхронизация client-list в уже запровиженном Xray-инбаунде
# (Шаг 2, docs/PRIORITY_PLAN.md — закрывает пробел "per-user client id",
# описанный в deploy/xray/provision-node.sh и docs/CHANGELOG.md).
#
# Проблема: provision-node.sh пишет inbound.settings.clients с ОДНИМ
# сгенерированным client id. backend/src/store/connection-config.ts выдаёт
# каждому пользователю свой персональный vlessUuid (User.vlessUuid) — этот
# id никогда не попадает в реальный Xray-конфиг, поэтому подключиться
# реально может только тот, кому руками прописали id (см. Decision о
# ручной e2e-проверке в DECISIONS.md).
#
# Это временное решение (re-render + restart), а не выбранная в плане
# альтернатива без даунтайма (Xray gRPC HandlerService) — см. TODO в
# PRIORITY_PLAN.md. Restart роняет активные соединения на этой ноде на
# секунду-две; для одной dev/staging ноды это приемлемо, для реального
# multi-user прода стоит перейти на HandlerService, чтобы не дёргать всех
# подключённых пользователей на каждый новый signup.
#
# Запускать НА самой Xray-ноде (тот же хост, где provision-node.sh поднял
# контейнер), по cron, например раз в 5 минут:
#   */5 * * * * /opt/simple-dimple/deploy/xray/sync-clients.sh --pool fr-test-1 --api-base https://<control-plane> --sync-token <FLEET_SYNC_TOKEN> >> /var/log/xray-sync-clients.log 2>&1
#
# Использование:
#   sync-clients.sh --pool <pool-code> --api-base <url> --sync-token <FLEET_SYNC_TOKEN>
#   sync-clients.sh --pool <pool-code> --api-base <url> --admin-session <x-auth-session-id>   # legacy
#
# --sync-token — выделенный статический токен (env FLEET_SYNC_TOKEN на
# backend'е): не истекает и даёт доступ ТОЛЬКО к /api/admin/vless-clients,
# в отличие от admin-сессии, которая истекает через ~30 дней (authSessionTtlMs)
# и открывает весь admin API. --admin-session оставлен для ручной отладки.
#
# ?pool=<code> в запросе — хартбит: backend отмечает ServerPool.clientsSyncedAt,
# и ops-алерт "xray-client-sync-stale" ловит молчаливую смерть этого крона
# (реальный инцидент 2026-07-10: потерянный бит исполнения — 20+ часов тихих
# Permission denied в кроне на обоих хостах).

set -euo pipefail

log() { echo "[sync-clients] $(date -u +%FT%TZ) $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed"
}

pool_code=""
api_base=""
admin_session=""
sync_token=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pool) pool_code="$2"; shift 2 ;;
    --api-base) api_base="$2"; shift 2 ;;
    --admin-session) admin_session="$2"; shift 2 ;;
    --sync-token) sync_token="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "$pool_code" ]] || die "--pool is required"
[[ -n "$api_base" ]] || die "--api-base is required"
[[ -n "$sync_token" || -n "$admin_session" ]] || die "--sync-token (or legacy --admin-session) is required"

if [[ -n "$sync_token" ]]; then
  auth_header="x-fleet-sync-token: $sync_token"
else
  auth_header="x-auth-session-id: $admin_session"
fi

require_cmd curl
require_cmd jq
require_cmd docker

config_path="/etc/xray-${pool_code}/config.json"
container_name="simple-dimple-xray-${pool_code}"

[[ -f "$config_path" ]] || die "$config_path not found — provision this node with provision-node.sh first"

log "Fetching current vless client list from $api_base"
clients_json="$(curl -sf -H "$auth_header" "$api_base/api/admin/vless-clients?pool=$pool_code")"
new_clients="$(echo "$clients_json" | jq '[.clients[] | {id: .uuid, flow: .flow}]')"

client_count="$(echo "$new_clients" | jq 'length')"
[[ "$client_count" -gt 0 ]] || die "Refusing to write an empty client list (got 0 clients from $api_base) — leaving existing config untouched"

current_clients="$(jq -c '.inbounds[0].settings.clients | sort_by(.id)' "$config_path")"
sorted_new_clients="$(echo "$new_clients" | jq -c 'sort_by(.id)')"

if [[ "$current_clients" == "$sorted_new_clients" ]]; then
  log "No change ($client_count clients) — skipping restart"
  exit 0
fi

log "Client list changed — writing $client_count client(s) to $config_path"
tmp_path="$(mktemp)"
jq --argjson clients "$new_clients" '.inbounds[0].settings.clients = $clients' "$config_path" > "$tmp_path"
# xray-core в этом образе бежит под non-root UID (65532) — mktemp по
# умолчанию даёт 600 (только root), контейнер не сможет прочитать конфиг
# после mv. Явно возвращаем те же права, что были у оригинала (644, как
# provision-node.sh изначально пишет файл).
chmod 644 "$tmp_path"
mv "$tmp_path" "$config_path"

log "Restarting $container_name to pick up the new client list"
docker restart "$container_name" >/dev/null

log "Done."
