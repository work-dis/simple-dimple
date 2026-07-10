import type { ConnectionConfigSummary, RoutePolicyCandidate, TelemetryFailureReason } from "../types";

// Шаг 3 (PRIORITY_PLAN.md) — client-side auto-fallback executor.
//
// docs/NETWORK_INTELLIGENCE.md, раздел 2 описывает recovery order на клиенте:
// last_known_good -> другой transport на том же IP -> другой IP в пуле ->
// другой provider/ASN -> сохранить победителя -> отправить probe result.
// backend уже строит ровно такой порядок в routePolicy.shortlist
// (backend/src/route-policy.ts) — этот модуль просто проходит по нему сам,
// вместо того чтобы требовать от пользователя ручного похода на экран Server.

export type TunnelAttemptResult = { ok: true } | { ok: false; error: string };

export interface ConnectFallbackDeps {
  // Пытается поднять туннель с данным конфигом. Не обязана сама делать timeout —
  // executor оборачивает вызов в withTimeout.
  attemptTunnel: (config: ConnectionConfigSummary) => Promise<TunnelAttemptResult>;
  // Достаёт connectionConfig для конкретного кандидата (POST /api/routes/resolve
  // с manualEndpointId) — не трогает session.status, поэтому безопасно вызывать
  // до официального подтверждения выбора.
  fetchCandidateConfig: (endpointId: string) => Promise<ConnectionConfigSummary | null>;
  // Шлёт feedback о провале конкретного кандидата (POST /api/routes/feedback)
  // раньше перехода к следующему — backend должен увидеть деградацию в реальном
  // времени, а не только post-factum.
  reportFailure: (candidate: RoutePolicyCandidate, failureReason: TelemetryFailureReason) => Promise<void>;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ConnectFallbackOutcome {
  ok: boolean;
  endpointId: string | null;
  candidate: RoutePolicyCandidate | null;
  attempts: number;
  lastError: string | null;
}

const defaultTimeoutMs = 7_000;
const defaultMaxAttempts = 4;

const knownFailureReasons = new Set<TelemetryFailureReason>([
  "timeout",
  "handshake_failed",
  "connect_refused",
  "dns_blocked",
  "captive_portal",
  "packet_loss_suspected",
  "tls_error",
  "unknown"
]);

function toFailureReason(error: string): TelemetryFailureReason {
  return knownFailureReasons.has(error as TelemetryFailureReason) ? (error as TelemetryFailureReason) : "unknown";
}

function withTimeout(pending: Promise<TunnelAttemptResult>, timeoutMs: number): Promise<TunnelAttemptResult> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: "timeout" });
    }, timeoutMs);

    pending
      .then((result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, error: error instanceof Error ? error.message : "Unknown tunnel error" });
      });
  });
}

/**
 * Проходит по routePolicy.shortlist по порядку, пока один из кандидатов не
 * подключится или список (либо maxAttempts) не кончится. Кандидат №1
 * переиспользует уже полученный initialConfig вместо повторного resolve.
 */
export async function connectWithFallback(
  shortlist: RoutePolicyCandidate[],
  initialConfig: ConnectionConfigSummary | null,
  deps: ConnectFallbackDeps
): Promise<ConnectFallbackOutcome> {
  const timeoutMs = deps.timeoutMs ?? defaultTimeoutMs;
  const candidates = shortlist.slice(0, Math.max(1, deps.maxAttempts ?? defaultMaxAttempts));

  let lastError: string | null = null;
  let attempts = 0;

  for (const candidate of candidates) {
    attempts += 1;

    const config =
      attempts === 1 && initialConfig && initialConfig.endpointId === candidate.endpointId
        ? initialConfig
        : await deps.fetchCandidateConfig(candidate.endpointId);

    if (!config) {
      lastError = `no connection config for ${candidate.endpointId}`;
      continue;
    }

    const result = await withTimeout(deps.attemptTunnel(config), timeoutMs);
    if (result.ok) {
      return { ok: true, endpointId: candidate.endpointId, candidate, attempts, lastError: null };
    }

    lastError = result.error;
    await deps.reportFailure(candidate, toFailureReason(result.error));
  }

  return { ok: false, endpointId: null, candidate: null, attempts, lastError };
}
