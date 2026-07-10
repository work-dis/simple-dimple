// Этап 8 (ROADMAP.md): "если отправка telemetry не удалась, клиент кеширует
// отчёт локально и отправляет позже". До этого модуля submitProbeReport()/
// reportCandidateFailure() молча теряли отчёт в catch-блоке при неудачной
// отправке — единичный сбой сети означал потерянный сигнал, а не отложенный.

const STORAGE_KEY = "simple-dimple.telemetry-queue-v1";
const MAX_QUEUE_SIZE = 20;

type QueuedTelemetryReport = {
  url: string;
  body: string;
  headers: Record<string, string>;
  queuedAt: string;
};

function readQueue(): QueuedTelemetryReport[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QueuedTelemetryReport[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedTelemetryReport[]) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    // Кап на размер очереди — грубая сетевая metadata небольшая, но защищаемся
    // от неограниченного роста localStorage при долгом offline-периоде;
    // самые старые непереданные отчёты вытесняются первыми.
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.slice(-MAX_QUEUE_SIZE)));
  } catch {
    // localStorage недоступен/переполнен — тот же best-effort принцип, что и
    // у самой telemetry: не даём кэшу сломать основной connect-flow.
  }
}

export function enqueueTelemetryReport(url: string, body: string, headers: Record<string, string>) {
  const queue = readQueue();
  queue.push({ url, body, headers, queuedAt: new Date().toISOString() });
  writeQueue(queue);
}

export async function flushTelemetryQueue() {
  const queue = readQueue();
  if (queue.length === 0) {
    return;
  }

  const remaining: QueuedTelemetryReport[] = [];

  for (const item of queue) {
    try {
      const response = await fetch(item.url, {
        method: "POST",
        headers: item.headers,
        body: item.body,
      });

      if (!response.ok) {
        remaining.push(item);
      }
    } catch {
      remaining.push(item);
    }
  }

  writeQueue(remaining);
}
