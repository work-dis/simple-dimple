import type { FastifySchema } from "fastify";

// Декларативные Fastify/ajv-схемы для эндпоинтов, где раньше валидация была
// продублирована руками (result/failureReason проверялись почти одинаково в
// probe/feedback/reprobe — см. server.ts) или вообще отсутствовала для типов
// чисел (registerEndpoint пропускал port: "abc" до Prisma, которая падала
// 500-кой). ajv у Fastify по умолчанию coerceTypes: true — "abc" для
// type: "integer" не коэрсится и роут падает с автоматическим 400 ещё до
// хендлера.

const telemetryProbeResultEnum = ["connected", "unstable", "failed"] as const;
const telemetryFailureReasonEnum = [
  "timeout",
  "handshake_failed",
  "connect_refused",
  "dns_blocked",
  "captive_portal",
  "packet_loss_suspected",
  "tls_error",
  "unknown"
] as const;
const routeFeedbackSourceEnum = ["resolve", "connect", "runtime_reprobe", "manual_report"] as const;

const networkContextProperties = {
  networkType: { type: "string", enum: ["wifi", "mobile", "unknown"] },
  carrier: { type: "string" },
  asn: { type: "number" },
  countryCode: { type: "string" },
  region: { type: "string" }
} as const;

// failureReason обязателен при result:"failed"; при strict === true (probe/feedback)
// дополнительно запрещён при result:"connected" — reprobe-результаты такого
// запрета никогда не имели, оставляем поведение как было.
function resultCrossCheck(strict: boolean): object[] {
  const checks: object[] = [
    {
      if: { properties: { result: { const: "failed" } }, required: ["result"] },
      then: { required: ["failureReason"] }
    }
  ];

  if (strict) {
    checks.push({
      if: { properties: { result: { const: "connected" } }, required: ["result"] },
      then: { not: { required: ["failureReason"] } }
    });
  }

  return checks;
}

export const telemetryProbeBodySchema: FastifySchema["body"] = {
  type: "object",
  required: ["endpointId", "transportProfile", "result", "testedAt"],
  properties: {
    ...networkContextProperties,
    endpointId: { type: "string", minLength: 1 },
    transportProfile: { type: "string", minLength: 1 },
    result: { type: "string", enum: telemetryProbeResultEnum },
    failureReason: { type: "string", enum: telemetryFailureReasonEnum },
    testedAt: { type: "string", minLength: 1 },
    latencyMs: { type: "number" },
    bytesSent: { type: "number" },
    bytesReceived: { type: "number" },
    appVersion: { type: "string" }
  },
  allOf: resultCrossCheck(true)
};

export const routeFeedbackBodySchema: FastifySchema["body"] = {
  type: "object",
  required: ["endpointId", "transportProfile", "result", "occurredAt"],
  properties: {
    ...networkContextProperties,
    endpointId: { type: "string", minLength: 1 },
    transportProfile: { type: "string", minLength: 1 },
    result: { type: "string", enum: telemetryProbeResultEnum },
    failureReason: { type: "string", enum: telemetryFailureReasonEnum },
    occurredAt: { type: "string", minLength: 1 },
    latencyMs: { type: "number" },
    appVersion: { type: "string" },
    source: { type: "string", enum: routeFeedbackSourceEnum },
    note: { type: "string" }
  },
  allOf: resultCrossCheck(true)
};

export const routeReprobeJobBodySchema: FastifySchema["body"] = {
  type: "object",
  properties: {
    ...networkContextProperties,
    candidateLimit: { type: "number", minimum: 1, maximum: 5 },
    maxAttempts: { type: "number", minimum: 1, maximum: 10 },
    note: { type: "string" },
    appVersion: { type: "string" },
    results: {
      type: "array",
      items: {
        type: "object",
        required: ["endpointId", "transportProfile", "result"],
        properties: {
          endpointId: { type: "string", minLength: 1 },
          transportProfile: { type: "string", minLength: 1 },
          result: { type: "string", enum: telemetryProbeResultEnum },
          failureReason: { type: "string", enum: telemetryFailureReasonEnum },
          latencyMs: { type: "number" },
          occurredAt: { type: "string" }
        },
        allOf: resultCrossCheck(false)
      }
    }
  }
};

// Протокольная diversity (Decision 052): раньше здесь были жёстко required
// REALITY-поля (publicKey/shortId/sni), что делало регистрацию
// trojan/shadowsocks-2022 endpoint'а невозможной через это же тело запроса.
// Теперь required — только общие для всех протоколов поля; protocol-specific
// обязательность (publicKey/shortId/sni для vless, trojanSni для trojan,
// ssServerKey для shadowsocks-2022) проверяется в
// store/endpoints.ts::registerEndpoint() по значению protocol, тем же
// паттерном, что уже был для остальных ручных проверок в этой функции.
export const registerAdminEndpointBodySchema: FastifySchema["body"] = {
  type: "object",
  required: ["label", "ipAddress", "provider", "countryCode", "poolCode", "protocol", "transportProfile", "port"],
  properties: {
    label: { type: "string", minLength: 1 },
    ipAddress: { type: "string", minLength: 1 },
    provider: { type: "string", minLength: 1 },
    asn: { type: "integer" },
    countryCode: { type: "string", minLength: 1 },
    city: { type: "string" },
    poolCode: { type: "string", minLength: 1 },
    region: { type: "string" },
    priority: { type: "integer" },
    protocol: { type: "string", minLength: 1 },
    transportProfile: { type: "string", minLength: 1 },
    latencyMs: { type: "integer" },
    loadPercent: { type: "integer" },
    port: { type: "integer", minimum: 1, maximum: 65535 },
    publicKey: { type: "string", minLength: 1 },
    shortId: { type: "string", minLength: 1 },
    sni: { type: "string", minLength: 1 },
    fingerprint: { type: "string" },
    flow: { type: "string" },
    trojanSni: { type: "string", minLength: 1 },
    trojanFingerprint: { type: "string" },
    trojanAlpn: { type: "string" },
    trojanCertSha256: { type: "string" },
    ssMethod: { type: "string" },
    ssServerKey: { type: "string", minLength: 1 }
  }
};
