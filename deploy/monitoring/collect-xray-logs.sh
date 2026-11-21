#!/usr/bin/env bash
set -euo pipefail

pool=${1:-}
output_dir=${2:-/var/lib/simple-dimple-monitoring}
if [[ ! "$pool" =~ ^[a-zA-Z0-9][a-zA-Z0-9_-]*$ ]]; then
  echo "Usage: $0 <pool-code> [textfile-directory]" >&2
  exit 2
fi

config_file="/etc/xray-${pool}/config.json"
if ! jq -e '(.log.loglevel // .log.logLevel) as $level |
  ($level == "info" or $level == "debug") and ((.log.error // "") == "")' "$config_file" >/dev/null; then
  echo "Xray log collection requires info logging to stdout for pool $pool" >&2
  exit 1
fi

# Snapshot the rolling window each run so restarts and retries never double count.
# Newer REALITY logs distinguish rejected ClientHellos from plain TCP checks.
# Older Xray versions only report a generic rejection.
snapshot_time=$(date +%s)
if ! rejected=$(
  timeout 20s docker logs --timestamps --since 5m "simple-dimple-xray-${pool}" 2>&1 |
    awk '
      /^[^ ]+ [0-9][0-9][0-9][0-9]\/[0-9][0-9]\/[0-9][0-9] [^ ]+ \[Info\] (\[[0-9]+\] )?transport\/internet\/tcp: REALITY: processed invalid connection/ {
        if (/processed invalid connection[[:space:]]*$/ ||
            /: (authentication failed or validation criteria not met|server name mismatch:.*|unsupported TLS version:.*)[[:space:]]*$/)
          count++
      }
      END { print count + 0 }
    '
); then
  echo "Cannot read Xray logs for pool $pool" >&2
  exit 1
fi

temporary_file=$(mktemp "${output_dir}/.xray-${pool}.XXXXXX")
trap 'rm -f "$temporary_file"' EXIT

cat > "$temporary_file" <<METRICS
# HELP xray_reality_rejections_last_5m Xray REALITY rejections observed in the last five minutes.
# TYPE xray_reality_rejections_last_5m gauge
xray_reality_rejections_last_5m{pool="$pool"} $rejected
# HELP xray_reality_log_collection_timestamp_seconds Unix timestamp of the last successful Xray log collection.
# TYPE xray_reality_log_collection_timestamp_seconds gauge
xray_reality_log_collection_timestamp_seconds{pool="$pool"} $snapshot_time
METRICS

chmod 0644 "$temporary_file"
mv -f "$temporary_file" "${output_dir}/xray-${pool}.prom"
