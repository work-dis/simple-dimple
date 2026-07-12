#!/usr/bin/env bash
#
# Периодическая синхронизация client-list в уже запровиженном Xray-инбаунде
# (Шаг 2, docs/PRIORITY_PLAN.md — закрывает пробел "per-user client id",
# описанный в deploy/xray/provision-node.sh и docs/CHANGELOG.md).
#
# Проблема: provision-node.sh пишет inbound.settings.clients с ОДНИМ
# сгенерированным client id. backend/src/store/connection-config.ts выдаёт
# каждому пользователю свой персональный vlessUuid/trojanPassword/
# shadowsocksUserKey — эти id никогда не попадают в реальный Xray-конфиг,
# поэтому подключиться реально может только тот, кому руками прописали id.
#
# Протокольная diversity (Decision 052, DECISIONS.md): нода теперь может
# нести несколько inbound'ов одновременно (vless+reality, trojan+tls,
# shadowsocks-2022) — этот скрипт синкает client-list КАЖДОГО inbound'а,
# который реально присутствует в config.json (найден по .protocol),
# используя отдельный control-plane эндпоинт на каждый протокол. Нода,
# у которой только один inbound (например только vless), просто не найдёт
# остальные — синкается то, что есть.
#
# Это временное решение (re-render + restart), а не выбранная в плане
# альтернатива без даунтайма (Xray gRPC HandlerService) — см. TODO в
# PRIORITY_PLAN.md. Restart роняет активные соединения на этой ноде на
# секунду-две при каждом изменении хотя бы одного inbound'а.
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
# backend'е): не истекает и даёт доступ ТОЛЬКО к /api/admin/*-clients,
# в отличие от admin-сессии, которая истекает через ~30 дней (authSessionTtlMs)
# и открывает весь admin API. --admin-session оставлен для ручной отладки.
#
# ?pool=<code> в запросе — хартбит: backend отмечает ServerPool.clientsSyncedAt
# на КАЖДОМ из трёх запросов ниже (idempotent — просто перезаписывает то же
# время), и ops-алерт "xray-client-sync-stale" ловит молчаливую смерть этого
# крона (реальный инцидент 2026-07-10: потерянный бит исполнения — 20+ часов
# тихих Permission denied в кроне на обоих хостах).

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

changed=0
tmp_path="$(mktemp)"
cp "$config_path" "$tmp_path"

# sync_inbound <admin-endpoint-path> <xray-protocol-name> <jq-filter-for-new-clients>
#
# jq-filter turns `.clients` from the control-plane response into the shape
# Xray expects for that inbound's settings.clients array.
sync_inbound() {
  local endpoint_path="$1" xray_protocol="$2" client_shape_filter="$3"

  local inbound_index
  inbound_index="$(jq "[.inbounds[].protocol] | index(\"${xray_protocol}\")" "$tmp_path")"
  if [[ "$inbound_index" == "null" ]]; then
    log "No ${xray_protocol} inbound in ${config_path} — skipping ${endpoint_path}"
    return 0
  fi

  log "Fetching current ${xray_protocol} client list from ${api_base}${endpoint_path}"
  local clients_json new_clients client_count
  clients_json="$(curl -sf -H "$auth_header" "${api_base}${endpoint_path}?pool=${pool_code}")"
  new_clients="$(echo "$clients_json" | jq "[.clients[] | ${client_shape_filter}]")"

  client_count="$(echo "$new_clients" | jq 'length')"
  if [[ "$client_count" -eq 0 ]]; then
    log "Refusing to write an empty ${xray_protocol} client list (got 0 from ${endpoint_path}) — leaving this inbound untouched"
    return 0
  fi

  local current_clients sorted_new_clients
  current_clients="$(jq -c ".inbounds[${inbound_index}].settings.clients | sort_by(tostring)" "$tmp_path")"
  sorted_new_clients="$(echo "$new_clients" | jq -c 'sort_by(tostring)')"

  if [[ "$current_clients" == "$sorted_new_clients" ]]; then
    log "No change for ${xray_protocol} (${client_count} clients) — skipping"
    return 0
  fi

  log "${xray_protocol} client list changed — writing ${client_count} client(s)"
  local next_path
  next_path="$(mktemp)"
  jq --argjson clients "$new_clients" ".inbounds[${inbound_index}].settings.clients = \$clients" "$tmp_path" > "$next_path"
  mv "$next_path" "$tmp_path"
  changed=1
}

sync_inbound "/api/admin/vless-clients" "vless" '{id: .uuid, flow: .flow}'
sync_inbound "/api/admin/trojan-clients" "trojan" '{password: .password}'
sync_inbound "/api/admin/shadowsocks-clients" "shadowsocks" '{password: .password}'

if [[ "$changed" -eq 0 ]]; then
  log "No inbound changed — skipping restart"
  rm -f "$tmp_path"
  exit 0
fi

# xray-core в этом образе бежит под non-root UID (65532) — mktemp по
# умолчанию даёт 600 (только root), контейнер не сможет прочитать конфиг
# после mv. Явно возвращаем те же права, что были у оригинала (644, как
# provision-node.sh изначально пишет файл).
chmod 644 "$tmp_path"
mv "$tmp_path" "$config_path"

log "Restarting $container_name to pick up the new client list(s)"
docker restart "$container_name" >/dev/null

log "Done."
