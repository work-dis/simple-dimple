#!/usr/bin/env bash
#
# Провижининг/retire Xray-ноды (Шаг 5, docs/PRIORITY_PLAN.md).
# Запускается НА целевом VPS (или через `ssh host 'bash -s' -- <args> < provision-node.sh`).
#
# Протокольная diversity (Decision 052, DECISIONS.md): `register` теперь
# одним запуском поднимает ВСЕ ТРИ протокола на одном хосте — VLESS+REALITY,
# Trojan+TLS, Shadowsocks-2022 — как три inbound'а одного и того же
# xray-core процесса на разных портах, и регистрирует три Endpoint-записи
# (одна на протокол, тот же ipAddress/poolCode) через Admin API. Раньше этот
# скрипт умел только VLESS+REALITY — если нужен ровно один протокол на
# новом хосте, остальные два просто не будут отвечать на своих портах, но
# они всё равно регистрируются в control-plane (см. --skip-trojan/--skip-ss
# ниже, если это реально нежелательно).
#
# ИЗВЕСТНЫЙ ПРОБЕЛ (не в скоупе этого скрипта, см. docs/PRIORITY_PLAN.md, Шаг 2):
# backend/src/store/connection-config.ts выдаёт каждому пользователю свой
# персональный vlessUuid/trojanPassword/shadowsocksUserKey (генерируются
# лениво), а не один общий id. Сгенерированный этим скриптом инстанс
# держит по ОДНОМУ placeholder-клиенту на inbound. Чтобы реальные разные
# пользователи могли подключаться, нужен периодический re-render конфига по
# реальным спискам — см. deploy/xray/sync-clients.sh (cron на самой ноде).
#
# Trojan-инбаунду нужен реальный TLS-сертификат (REALITY его не требует —
# заимствует чужой TLS-fingerprint, но не поднимает свой TLS handshake).
# В отсутствие настоящего домена/Let's Encrypt на этом хосте генерируется
# self-signed сертификат (openssl) — годится для dev/staging и для клиентов,
# которые сознательно принимают недоверенный сертификат (allowInsecure),
# но не для продакшн-стойкости к активному DPI, который проверяет цепочку
# доверия. Ротация/выпуск настоящего сертификата — отдельная задача.
#
# Использование:
#   provision-node.sh register --label "Paris Gamma" --provider Scaleway \
#     --asn 12876 --country FR --region France --pool par-d \
#     --api-base https://api.example.com --admin-session <x-auth-session-id> \
#     [--city Paris] [--priority 40] \
#     [--vless-port 8443] [--trojan-port 8444] [--ss-port 8445] [--ip <публичный IP>] \
#     [--skip-trojan] [--skip-shadowsocks]
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
vless_port="8443"
trojan_port="8444"
ss_port="8445"
ip_address=""
api_base=""
admin_session=""
endpoint_id=""
skip_trojan=""
skip_shadowsocks=""

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
    --port|--vless-port) vless_port="$2"; shift 2 ;;
    --trojan-port) trojan_port="$2"; shift 2 ;;
    --ss-port) ss_port="$2"; shift 2 ;;
    --ip) ip_address="$2"; shift 2 ;;
    --api-base) api_base="$2"; shift 2 ;;
    --admin-session) admin_session="$2"; shift 2 ;;
    --endpoint-id) endpoint_id="$2"; shift 2 ;;
    --skip-trojan) skip_trojan="1"; shift ;;
    --skip-shadowsocks) skip_shadowsocks="1"; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "$api_base" ]] || die "--api-base is required"
[[ -n "$admin_session" ]] || die "--admin-session is required"

register_endpoint_json() {
  # $1 = JSON payload
  curl -sf -X POST "$api_base/api/admin/endpoints" \
    -H "Content-Type: application/json" \
    -H "x-auth-session-id: $admin_session" \
    -d "$1"
}

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
    require_cmd openssl

    [[ -n "$label" ]] || die "--label is required"
    [[ -n "$provider" ]] || die "--provider is required"
    [[ -n "$country" ]] || die "--country is required"
    [[ -n "$pool_code" ]] || die "--pool is required"

    if [[ -z "$ip_address" ]]; then
      log "No --ip given, detecting public IP..."
      ip_address="$(curl -sf https://ifconfig.me || true)"
      [[ -n "$ip_address" ]] || die "Could not auto-detect public IP, pass --ip explicitly"
    fi

    config_dir="/etc/xray-${pool_code}"
    mkdir -p "$config_dir"
    config_path="$config_dir/config.json"
    container_name="simple-dimple-xray-${pool_code}"

    # --- VLESS + REALITY (всегда) ---
    log "Generating X25519 keypair via xray-core..."
    keypair_output="$(docker run --rm ghcr.io/xtls/xray-core:latest x25519)"
    vless_private_key="$(echo "$keypair_output" | grep -i 'Private' | awk '{print $NF}')"
    vless_public_key="$(echo "$keypair_output" | grep -i 'Public' | awk '{print $NF}')"
    [[ -n "$vless_private_key" && -n "$vless_public_key" ]] || die "Failed to parse x25519 keypair output:\n$keypair_output"

    vless_short_id="$(openssl rand -hex 8)"
    vless_client_uuid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen)"
    vless_sni="$(random_from_pool SNI_POOL)"
    vless_fingerprint="$(random_from_pool FINGERPRINT_POOL)"

    inbounds_json="$(cat <<EOF
{
  "listen": "0.0.0.0",
  "port": ${vless_port},
  "protocol": "vless",
  "settings": {
    "clients": [{ "id": "${vless_client_uuid}", "flow": "xtls-rprx-vision" }],
    "decryption": "none"
  },
  "streamSettings": {
    "network": "tcp",
    "security": "reality",
    "realitySettings": {
      "show": false,
      "dest": "${vless_sni}:443",
      "xver": 0,
      "serverNames": ["${vless_sni}"],
      "privateKey": "${vless_private_key}",
      "shortIds": ["${vless_short_id}"]
    }
  }
}
EOF
)"

    # --- Trojan + TLS (если не --skip-trojan) ---
    if [[ -z "$skip_trojan" ]]; then
      log "Generating self-signed TLS cert for Trojan inbound..."
      trojan_cert_path="${config_dir}/trojan-cert.pem"
      trojan_key_path="${config_dir}/trojan-key.pem"
      trojan_sni="$(random_from_pool SNI_POOL)"
      trojan_fingerprint="$(random_from_pool FINGERPRINT_POOL)"
      trojan_placeholder_password="$(openssl rand -hex 16)"

      # -addext subjectAltName обязателен — найдено живой проверкой на
      # 57.128.220.83 (Decision 053, DECISIONS.md): Go 1.15+ (используется
      # xray-core) жёстко отвергает сертификаты без SAN ("certificate
      # relies on legacy Common Name field, use SANs instead"), CN-only
      # сертификат не проходит TLS handshake вообще ни у одного клиента,
      # даже с pinned-хэшем.
      openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$trojan_key_path" -out "$trojan_cert_path" \
        -days 3650 -subj "/CN=${trojan_sni}" \
        -addext "subjectAltName=DNS:${trojan_sni}" >/dev/null 2>&1

      # Найдено живой проверкой на 57.128.220.83 (Decision 053, DECISIONS.md):
      # современный xray-core убрал `allowInsecure` в пользу
      # `pinnedPeerCertSha256`, которое ожидает HEX (не base64!) —
      # тот же формат, что `xray tls hash --cert`/`openssl x509
      # -fingerprint -sha256` (без двоеточий, lowercase). Пин передаётся в
      # Admin API как trojanCertSha256 и попадает в выдаваемый
      # connection-config.
      trojan_cert_sha256="$(openssl x509 -in "$trojan_cert_path" -noout -fingerprint -sha256 | sed 's/^.*=//; s/://g' | tr 'A-F' 'a-f')"

      inbounds_json="${inbounds_json},$(cat <<EOF
{
  "listen": "0.0.0.0",
  "port": ${trojan_port},
  "protocol": "trojan",
  "settings": {
    "clients": [{ "password": "${trojan_placeholder_password}" }]
  },
  "streamSettings": {
    "network": "tcp",
    "security": "tls",
    "tlsSettings": {
      "alpn": ["h2", "http/1.1"],
      "certificates": [{ "certificateFile": "/etc/xray/trojan-cert.pem", "keyFile": "/etc/xray/trojan-key.pem" }]
    }
  }
}
EOF
)"
    fi

    # --- Shadowsocks-2022 (если не --skip-shadowsocks) ---
    if [[ -z "$skip_shadowsocks" ]]; then
      # 256-bit cipher — 32-байтный PSK, тот же размер, что
      # connection-config.ts генерирует для per-user ключей (см. schema.prisma
      # ShadowsocksTransportConfig.method).
      ss_method="2022-blake3-aes-256-gcm"
      ss_server_key="$(openssl rand -base64 32)"
      ss_placeholder_user_key="$(openssl rand -base64 32)"

      inbounds_json="${inbounds_json},$(cat <<EOF
{
  "listen": "0.0.0.0",
  "port": ${ss_port},
  "protocol": "shadowsocks",
  "settings": {
    "method": "${ss_method}",
    "password": "${ss_server_key}",
    "network": "tcp,udp",
    "clients": [{ "password": "${ss_placeholder_user_key}" }]
  }
}
EOF
)"
    fi

    log "Writing multi-protocol Xray inbound config to $config_path"
    cat > "$config_path" <<EOF
{
  "log": { "loglevel": "warning" },
  "inbounds": [${inbounds_json}],
  "outbounds": [{ "protocol": "freedom" }]
}
EOF

    log "Starting/replacing Xray container $container_name (ports ${vless_port}$( [[ -z "$skip_trojan" ]] && echo "/${trojan_port}")$( [[ -z "$skip_shadowsocks" ]] && echo "/${ss_port}"))"
    docker rm -f "$container_name" >/dev/null 2>&1 || true

    port_args=(-p "${vless_port}:${vless_port}")
    volume_args=(-v "${config_path}:/etc/xray/config.json:ro")
    if [[ -z "$skip_trojan" ]]; then
      port_args+=(-p "${trojan_port}:${trojan_port}")
      volume_args+=(-v "${trojan_cert_path}:/etc/xray/trojan-cert.pem:ro" -v "${trojan_key_path}:/etc/xray/trojan-key.pem:ro")
    fi
    if [[ -z "$skip_shadowsocks" ]]; then
      port_args+=(-p "${ss_port}:${ss_port}/tcp" -p "${ss_port}:${ss_port}/udp")
    fi

    docker run -d \
      --name "$container_name" \
      --restart unless-stopped \
      "${port_args[@]}" \
      "${volume_args[@]}" \
      ghcr.io/xtls/xray-core:latest run -config /etc/xray/config.json

    log "Registering vless endpoint in control-plane ($api_base)"
    register_endpoint_json "$(cat <<EOF
{
  "label": "${label} (VLESS)",
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
  "port": ${vless_port},
  "publicKey": "${vless_public_key}",
  "shortId": "${vless_short_id}",
  "sni": "${vless_sni}",
  "fingerprint": "${vless_fingerprint}",
  "flow": "xtls-rprx-vision"
}
EOF
)" | tee /dev/stderr

    if [[ -z "$skip_trojan" ]]; then
      log "Registering trojan endpoint in control-plane ($api_base)"
      register_endpoint_json "$(cat <<EOF
{
  "label": "${label} (Trojan)",
  "ipAddress": "${ip_address}",
  "provider": "${provider}",
  "asn": ${asn:-null},
  "countryCode": "${country}",
  "city": $( [[ -n "$city" ]] && echo "\"$city\"" || echo null ),
  "poolCode": "${pool_code}",
  "region": $( [[ -n "$region" ]] && echo "\"$region\"" || echo null ),
  "priority": ${priority},
  "protocol": "trojan",
  "transportProfile": "tls-tcp",
  "port": ${trojan_port},
  "trojanSni": "${trojan_sni}",
  "trojanFingerprint": "${trojan_fingerprint}",
  "trojanAlpn": "h2,http/1.1",
  "trojanCertSha256": "${trojan_cert_sha256}"
}
EOF
)" | tee /dev/stderr
    fi

    if [[ -z "$skip_shadowsocks" ]]; then
      log "Registering shadowsocks-2022 endpoint in control-plane ($api_base)"
      register_endpoint_json "$(cat <<EOF
{
  "label": "${label} (Shadowsocks-2022)",
  "ipAddress": "${ip_address}",
  "provider": "${provider}",
  "asn": ${asn:-null},
  "countryCode": "${country}",
  "city": $( [[ -n "$city" ]] && echo "\"$city\"" || echo null ),
  "poolCode": "${pool_code}",
  "region": $( [[ -n "$region" ]] && echo "\"$region\"" || echo null ),
  "priority": ${priority},
  "protocol": "shadowsocks-2022",
  "transportProfile": "tcp-emergency",
  "port": ${ss_port},
  "ssMethod": "${ss_method}",
  "ssServerKey": "${ss_server_key}"
}
EOF
)" | tee /dev/stderr
    fi

    log "Done. Node registered — see 'Fleet' section in Ops for status."
    ;;

  *)
    die "Unknown command '$cmd' — use register, retire or reactivate"
    ;;
esac
