# Xray dev inbound

Это **не production-конфиг**. `dev-config.json` поднимает единственный VLESS+REALITY
inbound на `127.0.0.1:8443` для локальной разработки и ручной проверки Этапа 2a
из [../../docs/PRIORITY_PLAN.md](../../docs/PRIORITY_PLAN.md).

Запуск:

```
docker compose --profile xray up xray
```

`privateKey`/`shortIds`/клиентский `id` в этом файле — реальный сгенерированный
X25519-keypair, но он живёт только в этом репозитории и предназначен исключительно
для локальной проверки. Соответствующий `publicKey`/`shortId`/`sni` продублированы
в `backend/src/defaults.ts` (`defaultEndpointTransportConfigs`) — backend строит
`connectionConfig` из этих же значений, поэтому конфиг, выданный API, реально
подходит для подключения к этому inbound.

Для production-узла: сгенерировать новый keypair (`xray x25519` или
`docker run --rm ghcr.io/xtls/xray-core:latest x25519`), не переиспользовать
dev-значения, и завести реальные transport-параметры в БД через
`EndpointTransportConfig` вместо `defaults.ts`.
