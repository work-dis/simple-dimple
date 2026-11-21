# Мониторинг Xray и уведомления в Telegram

| Алерт | Когда срабатывает |
| --- | --- |
| `XrayPossibleIPBlock` | Пять минут TCP-порт одного IP доступен из контрольной сети и недоступен из наблюдаемой. Причиной может быть фильтрация, firewall или проблема маршрутизации. |
| `XrayEndpointUnreachable` | Пять минут TCP-порт недоступен из двух или более сетей, и успешных проверок этого порта нет. |
| `XrayPossibleProbing` | За скользящее пятиминутное окно собрано не менее 30 отклонений REALITY, и порог превышен или достигнут не менее двух минут подряд. Причиной могут быть также ошибочные настройки клиентов. |
| `XrayMonitoringTargetDown`, `XrayLogCollectionStale` | Prometheus потерял доступ к экспортёру или экспортёр перестал получать свежие данные из журнала Xray. |

TCP-проверка показывает доступность конкретного порта. Для проверки работы VPN после установления TCP требуется подключение настоящего клиента. Сборщик считает отказанные рукопожатия REALITY. Сами логи и адреса подключавшихся клиентов остаются на узле. Alertmanager отправляет сообщения при срабатывании и восстановлении. [Blackbox Exporter](https://github.com/prometheus/blackbox_exporter/blob/master/CONFIGURATION.md) · [Причины отклонения REALITY](https://github.com/XTLS/REALITY/blob/main/tls.go) · [Настройка Telegram в Alertmanager](https://prometheus.io/docs/alerting/latest/configuration/#telegram_config)

## Подключение к существующему Prometheus

Подключите [правила](rules/xray.yml) через `rule_files`, перенесите задания `xray_tcp` и `xray_logs` из [prometheus.yml](prometheus.yml) и настройте пути к файлам целей относительно конфигурации Prometheus. Если контрольный экспортёр находится вне сети Compose, замените `blackbox:9115` его приватным адресом.

В существующем Alertmanager добавьте Telegram receiver из [alertmanager.yml](alertmanager.yml) и маршрут по одному или обоим заданиям либо по названиям алертов. Пути к файлам токена и ID чата должны быть доступны процессу Alertmanager. Для этой конфигурации нужен Alertmanager с поддержкой `chat_id_file` (например, версия из `compose.yaml`).

## Запуск отдельного стека

Запускайте команды из `deploy/monitoring`. Центральный Prometheus и Alertmanager можно разместить на хосте в контрольной сети. Для наблюдаемой сети нужен второй Blackbox Exporter, который выходит к Xray через соответствующего провайдера.

1. На хосте наблюдаемой сети запустите Blackbox Exporter. Укажите локальный адрес приватной сети, по которой центральный Prometheus может обратиться к экспортёру.

   ```bash
   MONITORING_BIND_IP=192.0.2.30 docker compose -f compose.agent.yaml up -d blackbox
   ```

2. На каждом узле Xray с REALITY задайте `"loglevel": "info"` в объекте `log` файла `/etc/xray-<pool-code>/config.json`. Для `log.error` используйте стандартный вывод (поле отсутствует или пустое). Перезапустите существующий контейнер после применения конфигурации. Для информационных логов используйте лог-драйвер Docker с ротацией и доступом через `docker logs`. [Конфигурация журнала Xray](https://xtls.github.io/en/config/log.html)

   Установите сборщик на узле и один раз запустите его для каждого пула REALITY. Укажите имя пула и приватный IP узла вместо `fr-1` и `192.0.2.40`. Нужны `jq`, `timeout` и доступ к Docker.

   ```bash
   sudo install -d -m 0755 /var/lib/simple-dimple-monitoring
   sudo install -m 0755 collect-xray-logs.sh /usr/local/sbin/collect-simple-dimple-xray-logs
   sudo /usr/local/sbin/collect-simple-dimple-xray-logs fr-1
   MONITORING_BIND_IP=192.0.2.40 docker compose -f compose.agent.yaml up -d node-exporter
   ```

   Добавьте в root crontab по строке на пул. При выводе пула из мониторинга удалите его задание и соответствующий файл `/var/lib/simple-dimple-monitoring/xray-<pool-code>.prom`.

   ```cron
   * * * * * /usr/local/sbin/collect-simple-dimple-xray-logs fr-1
   ```

   Оставьте порты 9115 и 9100 доступными только Prometheus через приватное соединение. Экспортёры не требуют аутентификации.

3. На центральном хосте создайте рабочие файлы.

   ```bash
   install -d -m 0700 local
   install -d -m 0755 local/targets
   cp examples/xray-tcp.yml examples/xray-logs.yml local/targets/
   ```

   В `local/targets/xray-tcp.yml` укажите один и тот же набор реальных `IP:порт` Xray для каждой сети. Для контрольной сети сохраните `probe_site: reference`. Для наблюдаемых сетей присвойте уникальные `probe_site` и укажите приватный адрес соответствующего экспортёра в `probe_address`. В `local/targets/xray-logs.yml` укажите приватные адреса Node Exporter на узлах Xray. Если пока включаете только TCP-проверки, запишите в файл целей логов `[]`.

4. Поместите токен бота в `local/telegram_bot_token`, а числовой ID чата в `local/telegram_chat_id`, каждый одной строкой. Добавьте бота в целевой чат и предоставьте ему право отправлять сообщения. Для Docker Compose с привязкой файлов каталог `local` защищён режимом `0700`, а сами файлы должны быть читаемы пользователем контейнера.

   ```bash
   chmod 0644 local/targets/*.yml
   chmod 0444 local/telegram_bot_token local/telegram_chat_id
   docker compose config --quiet
   docker compose up -d
   ```

## Проверка

Через SSH port forwarding откройте Prometheus (`127.0.0.1:9090`) и Alertmanager (`127.0.0.1:9093`). В `/targets` проверьте, что источники доступны, затем проверьте `probe_success{job="xray_tcp"}` по каждому `probe_site` и `xray_reality_log_collection_timestamp_seconds` по каждому пулу. Если Telegram не получает сообщения, проверьте `alertmanager_notifications_failed_total{integration="telegram"}` и `docker compose logs alertmanager`.

Проверка конфигурации после подготовки `local/targets` и секретов:

```bash
docker compose run --rm --no-deps --entrypoint /bin/promtool prometheus \
  check config /etc/prometheus/prometheus.yml
docker compose run --rm --no-deps --entrypoint /bin/promtool prometheus \
  test rules /etc/prometheus/rules/xray.test.yml
docker compose run --rm --no-deps --entrypoint /bin/amtool alertmanager \
  check-config /etc/alertmanager/alertmanager.yml
```
