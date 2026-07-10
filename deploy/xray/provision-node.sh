#!/usr/bin/env bash
#
# Провижининг/retire Xray VLESS+REALITY ноды (Шаг 5, docs/PRIORITY_PLAN.md).
# Запускается НА целевом VPS (или через `ssh host 'bash -s' -- <args> < provision-node.sh`).
#
# НЕ ЗАПУСКАЛСЯ НИ РАЗУ — в dev-среде, где это писалось, нет Docker и нет
# реального VPS для проверки. "Код без сборки", как и остальной Шаг 5 —
# см. docs/CHANGELOG.md.
#
# ИЗВЕСТНЫЙ ПРОБЕЛ (не в скоупе этого скрипта, см. docs/PRIORITY_PLAN.md, Шаг 2):
# backend/src/store/connection-config.ts выдаёт каждому пользователю свой
# персональный vlessUuid (генерируется лениво на User), а не один общий id.
# Сгенерированный этим скриптом inbound (как и текущий dev-config.json)
# держит только ОДИН client-id. Чтобы реальные разные пользователи могли
# подключаться к одной ноде, нужен либо периодический re-render конфига по
# списку User.vlessUuid + reload, либо Xray gRPC HandlerService для
# динамического добавления клиентов — это отдельная задача, не часть
# fleet-provisioning (add/remove node), которым занимается этот скрипт.
#
# Использование:
#   provision-node.sh register --label "Paris Gamma" --provider Scaleway \
#     --asn 12876 --country FR --region France --pool par-d \
#     --api-base https://api.example.com --admin-session <x-auth-session-id> \
#     [--city Paris] [--priority 40] [--port 8443] [--ip <публичный IP>]
#
#   provision-node.sh retire --api-base https://api.example.com \
#     --admin-session <x-auth-session-id> --endpoint-id <id>
#
#   provision-node.sh reactivate --api-base ... --admin-session ... --endpoint-id <id>

set -euo pipefail

# Стартовый пул фасадных доменов/fingerprint'ов — намеренно маленький.
# Шаг 6 (PRIORITY_PLAN.md) должен расширить его и решить вопрос
# bridge-модели распространения; здесь только "не один и тот же домен на
# всех нодах".
SNI_POOL=(
  "www.microsoft.com"
  "www.cloudflare.com"
  "www.amazon.com"
  "www.wikipedia.org"
)
FINGERPRINT_POOL=(
  "chrome"
  "firefox"
  "safari"
)

log() { echo "[provision-node] $*" >&2; }
die() { log "ERROR: $*"; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed"
}

random_from_pool() {
  local -n pool_ref=$1
  echo "${pool_ref[$((RANDOM % ${#pool_ref[@]}))]}"
}

cmd="${1:-}"
shift || true

label=""
provider=""
asn=""
country=""
region=""
city=""
pool_code=""
priority="50"
port="8443"
ip_address=""
api_base=""
admin_session=""
endpoint_id=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --provider) provider="$2"; shift 2 ;;
    --asn) asn="$2"; shift 2 ;;
    --country) country="$2"; shift 2 ;;
    --region) region="$2"; shift 2 ;;
    --city) city="$2"; shift 2 ;;
    --pool) pool_code="$2"; shift 2 ;;
    --priority) priority="$2"; shift 2 ;;
    --port) port="$2"; shift 2 ;;
    --ip) ip_address="$2"; shift 2 ;;
    --api-base) api_base="$2"; shift 2 ;;
    --admin-session) admin_session="$2"; shift 2 ;;
    --endpoint-id) endpoint_id="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "$api_base" ]] || die "--api-base is required"
[[ -n "$admin_session" ]] || die "--admin-session is required"

case "$cmd" in
  retire|reactivate)
    require_cmd curl
    [[ -n "$endpoint_id" ]] || die "--endpoint-id is required for $cmd"
    is_active=$([[ "$cmd" == "reactivate" ]] && echo true || echo false)

    log "Setting endpoint $endpoint_id isActive=$is_active on $api_base"
    curl -sf -X PATCH "$api_base/api/admin/endpoints/$endpoint_id" \
      -H "Content-Type: application/json" \
      -H "x-auth-session-id: $admin_session" \
      -d "{\"isActive\": $is_active}" | tee /dev/stderr
    ;;

  register)
    require_cmd docker
    require_cmd curl

    [[ -n "$label" ]] || die "--label is required"
    [[ -n "$provider" ]] || die "--provider is required"
    [[ -n "$country" ]] || die "--country is required"
    [[ -n "$pool_code" ]] || die "--pool is required"

    if [[ -z "$ip_address" ]]; then
      log "No --ip given, detecting public IP..."
      ip_address="$(curl -sf https://ifconfig.me || true)"
      [[ -n "$ip_address" ]] || die "Could not auto-detect public IP, pass --ip explicitly"
    fi

    log "Generating X25519 keypair via xray-core..."
    keypair_output="$(docker run --rm ghcr.io/xtls/xray-core:latest x25519)"
    private_key="$(echo "$keypair_output" | grep -i 'Private' | awk '{print $NF}')"
    public_key="$(echo "$keypair_output" | grep -i 'Public' | awk '{print $NF}')"
    [[ -n "$private_key" && -n "$public_key" ]] || die "Failed to parse x25519 keypair output:\n$keypair_output"

    short_id="$(openssl rand -hex 8)"
    client_uuid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)"
    sni="$(random_from_pool SNI_POOL)"
    fingerprint="$(random_from_pool FINGERPRINT_POOL)"

    config_dir="/etc/xray-${pool_code}"
    mkdir -p "$config_dir"
    config_path="$config_dir/config.json"

    log "Writing Xray inbound config to $config_path (sni=$sni, fingerprint=$fingerprint)"
    cat > "$config_path" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [
    {
      "listen": "0.0.0.0",
      "port": ${port},
      "protocol": "vless",
      "settings": {
        "clients": [
          { "id": "${client_uuid}", "flow": "xtls-rprx-vision" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "tcp",
        "security": "reality",
        "realitySettings": {
          "show": false,
          "dest": "${sni}:443",
          "xver": 0,
          "serverNames": ["${sni}"],
          "privateKey": "${private_key}",
          "shortIds": ["${short_id}"]
        }
      }
    }
  ],
  "outbounds": [{ "protocol": "freedom" }]
}
EOF

    container_name="simple-dimple-xray-${pool_code}"
    log "Starting/replacing Xray container $container_name on port $port"
    docker rm -f "$container_name" >/dev/null 2>&1 || true
    docker run -d \
      --name "$container_name" \
      --restart unless-stopped \
      -p "${port}:${port}" \
      -v "${config_path}:/etc/xray/config.json:ro" \
      ghcr.io/xtls/xray-core:latest run -config /etc/xray/config.json

    log "Registering endpoint in control-plane ($api_base)"
    payload=$(cat <<EOF
{
  "label": "${label}",
  "ipAddress": "${ip_address}",
  "provider": "${provider}",
  "asn": ${asn:-null},
  "countryCode": "${country}",
  "city": $( [[ -n "$city" ]] && echo "\"$city\"" || echo null ),
  "poolCode": "${pool_code}",
  "region": $( [[ -n "$region" ]] && echo "\"$region\"" || echo null ),
  "priority": ${priority},
  "protocol": "vless",
  "transportProfile": "reality-tcp",
  "port": ${port},
  "publicKey": "${public_key}",
  "shortId": "${short_id}",
  "sni": "${sni}",
  "fingerprint": "${fingerprint}",
  "flow": "xtls-rprx-vision"
}
EOF
)

    curl -sf -X POST "$api_base/api/admin/endpoints" \
      -H "Content-Type: application/json" \
      -H "x-auth-session-id: $admin_session" \
      -d "$payload" | tee /dev/stderr

    log "Done. Node registered — see 'Fleet' section in Ops for status."
    ;;

  *)
    die "Unknown command '$cmd' — use register, retire or reactivate"
    ;;
esac
