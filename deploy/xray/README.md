# Xray dev inbound

Это **не production-конфиг**. `dev-config.json` поднимает единственный VLESS+REALITY
inbound на `127.0.0.1:8443` для локальной разработки и ручной проверки Этапа 2a
из [../../docs/PRIORITY_PLAN.md](../../docs/PRIORITY_PLAN.md).

Файл `dev-config.json` **не коммитится** (см. `.gitignore`) — в нём живёт реальный
X25519 `privateKey`, а ключ, к которому есть доступ у кого угодно с клоном
репозитория, для REALITY бесполезен как секрет: им можно MITM-ить любой inbound,
куда его скопируют. Поэтому каждый разработчик генерирует свой keypair локально:

```
./generate-dev-config.sh
docker compose --profile xray up xray
```

Скрипт создаёт `dev-config.json` из `dev-config.template.json` со свежим
keypair'ом, shortId и client UUID, и печатает `publicKey`/`shortId` — их нужно
завести в `EndpointTransportConfig` для `de-fra-1` (через admin API или
напрямую в БД), чтобы `connectionConfig`, который отдаёт backend, реально
подходил для подключения к этому inbound.

Для production-узла ключ отдельно генерировать не нужно — это уже делает
Ansible-роль `deploy/ansible/roles/xray_node` при первом провижене (см. её
`tasks/main.yml`): keypair создаётся на хосте и никогда не покидает его /
инвентарь.
