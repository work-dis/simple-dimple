#!/usr/bin/env bash
# Генерирует локальный dev-config.json с новым X25519-keypair.
# dev-config.json не коммитится (см. .gitignore) — каждый разработчик
# заводит свой ключ, ключ никогда не попадает в git.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if [[ -f dev-config.json ]]; then
  echo "dev-config.json уже существует, ничего не делаю (удалите файл, чтобы перегенерировать)." >&2
  exit 0
fi

keypair_output="$(docker run --rm ghcr.io/xtls/xray-core:latest x25519)"
private_key="$(echo "$keypair_output" | sed -n 's/^PrivateKey: //p')"
public_key="$(echo "$keypair_output" | sed -n 's/^Password (PublicKey): //p' | head -n1)"
if [[ -z "$public_key" ]]; then
  public_key="$(echo "$keypair_output" | sed -n 's/^Public key: //p')"
fi
short_id="$(openssl rand -hex 8)"
client_uuid="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid; print(uuid.uuid4())')"

sed \
  -e "s/__PRIVATE_KEY__/${private_key}/" \
  -e "s/__SHORT_ID__/${short_id}/" \
  -e "s/__CLIENT_UUID__/${client_uuid}/" \
  dev-config.template.json > dev-config.json

echo "dev-config.json создан."
echo
echo "Публичные параметры для backend/src/defaults.ts (defaultEndpointTransportConfigs)"
echo "или для локального EndpointTransportConfig в БД:"
echo "  publicKey: ${public_key}"
echo "  shortId:   ${short_id}"
