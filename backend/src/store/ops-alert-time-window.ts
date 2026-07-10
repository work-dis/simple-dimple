// --------------------------------------------------------------------------
// Pure time-window helpers used by the ops-alert delivery cooldown/cadence/
// quiet-window throttling policies inside createOpsAlertStore.
// --------------------------------------------------------------------------

export function formatCooldownWindow(durationMs: number) {
  const minutes = Math.round(durationMs / 60_000);
  if (minutes < 60) {
    return `${minutes} minute cooldown`;
  }

  const hours = Math.round((minutes / 60) * 10) / 10;
  return `${hours} hour cooldown`;
}

export function parseUtcHour(value: number | undefined, fallback: number) {
  const safeValue = Number.isFinite(value) ? Math.trunc(value as number) : fallback;
  return Math.min(Math.max(safeValue, 0), 23);
}

export function formatUtcHour(hour: number) {
  return `${hour.toString().padStart(2, "0")}:00 UTC`;
}

export function isHourInsideWindow(hour: number, startHourUtc: number, endHourUtc: number) {
  if (startHourUtc === endHourUtc) {
    return true;
  }

  if (startHourUtc < endHourUtc) {
    return hour >= startHourUtc && hour < endHourUtc;
  }

  return hour >= startHourUtc || hour < endHourUtc;
}
