import type {
  ShadowsocksConnectionConfigSummary,
  TrojanConnectionConfigSummary,
  VlessConnectionConfigSummary
} from "./types.js";

export type VlessRealityTransportParams = {
  ipAddress: string;
  port: number;
  publicKey: string;
  shortId: string;
  sni: string;
  fingerprint: string;
  flow: string;
};

export function buildVlessRealityConnectionUri(input: {
  clientUuid: string;
  label: string;
  transport: VlessRealityTransportParams;
}): string {
  const { clientUuid, label, transport } = input;
  const query = new URLSearchParams({
    encryption: "none",
    flow: transport.flow,
    security: "reality",
    sni: transport.sni,
    fp: transport.fingerprint,
    pbk: transport.publicKey,
    sid: transport.shortId,
    type: "tcp"
  });

  return `vless://${clientUuid}@${transport.ipAddress}:${transport.port}?${query.toString()}#${encodeURIComponent(label)}`;
}

export function buildVlessRealityConnectionConfig(input: {
  endpointId: string;
  clientUuid: string;
  label: string;
  transport: VlessRealityTransportParams;
}): VlessConnectionConfigSummary {
  return {
    endpointId: input.endpointId,
    protocol: "vless",
    security: "reality",
    uri: buildVlessRealityConnectionUri(input),
    params: {
      uuid: input.clientUuid,
      address: input.transport.ipAddress,
      port: input.transport.port,
      flow: input.transport.flow,
      sni: input.transport.sni,
      fingerprint: input.transport.fingerprint,
      publicKey: input.transport.publicKey,
      shortId: input.transport.shortId
    }
  };
}

// Trojan+TLS — первый fallback-протокол (ROADMAP.md, Этап 6). Пароль —
// per-user секрет (User.trojanPassword), остальное — общие для ноды
// transport-параметры (TrojanTransportConfig).
export type TrojanTlsTransportParams = {
  ipAddress: string;
  port: number;
  sni: string;
  fingerprint: string;
  alpn: string;
  // hex(SHA-256(DER cert)) — формат `xray tls hash --cert`/`openssl x509
  // -fingerprint -sha256` (без двоеточий, lowercase), НЕ base64. Обязателен
  // на практике для self-signed нод без своего домена (Decision 053,
  // DECISIONS.md): найдено живой проверкой на 57.128.220.83 — современный
  // xray-core убрал `allowInsecure` в пользу `pinnedPeerCertSha256`
  // (hex-строка), без него TLS handshake падает у любого клиента. null —
  // для ноды с настоящим CA-сертификатом, где pinning не нужен.
  certSha256: string | null;
};

export function buildTrojanConnectionUri(input: {
  password: string;
  label: string;
  transport: TrojanTlsTransportParams;
}): string {
  const { password, label, transport } = input;
  const query = new URLSearchParams({
    security: "tls",
    sni: transport.sni,
    fp: transport.fingerprint,
    alpn: transport.alpn,
    type: "tcp"
  });
  if (transport.certSha256) {
    // Не часть стандартного trojan:// URI-формата — но это внутренний
    // формат для наших же клиентов (native-плагин строит xray-core JSON из
    // этих же params), не для сторонних reference-клиентов, так что
    // произвольный query-параметр здесь безопасен.
    query.set("certSha256", transport.certSha256);
  }

  return `trojan://${encodeURIComponent(password)}@${transport.ipAddress}:${transport.port}?${query.toString()}#${encodeURIComponent(label)}`;
}

export function buildTrojanConnectionConfig(input: {
  endpointId: string;
  password: string;
  label: string;
  transport: TrojanTlsTransportParams;
}): TrojanConnectionConfigSummary {
  return {
    endpointId: input.endpointId,
    protocol: "trojan",
    security: "tls",
    uri: buildTrojanConnectionUri(input),
    params: {
      password: input.password,
      address: input.transport.ipAddress,
      port: input.transport.port,
      sni: input.transport.sni,
      fingerprint: input.transport.fingerprint,
      certSha256: input.transport.certSha256,
      alpn: input.transport.alpn
    }
  };
}

// Shadowsocks-2022 — emergency fallback-протокол (ROADMAP.md, Этап 6).
// Multi-user 2022-схема: серверный PSK (EndpointTransportConfig.serverKey,
// общий для ноды) + персональный PSK пользователя (User.shadowsocksUserKey),
// итоговый ключ клиента — "serverKey:userKey" (см. SIP002 / shadowsocks-2022
// multi-user extension).
export type ShadowsocksTransportParams = {
  ipAddress: string;
  port: number;
  method: string;
};

export function buildShadowsocksConnectionUri(input: {
  serverKey: string;
  userKey: string;
  label: string;
  transport: ShadowsocksTransportParams;
}): string {
  const { serverKey, userKey, label, transport } = input;
  const combinedKey = `${serverKey}:${userKey}`;
  const userInfo = Buffer.from(`${transport.method}:${combinedKey}`, "utf8").toString("base64url");

  return `ss://${userInfo}@${transport.ipAddress}:${transport.port}#${encodeURIComponent(label)}`;
}

export function buildShadowsocksConnectionConfig(input: {
  endpointId: string;
  serverKey: string;
  userKey: string;
  label: string;
  transport: ShadowsocksTransportParams;
}): ShadowsocksConnectionConfigSummary {
  return {
    endpointId: input.endpointId,
    protocol: "shadowsocks-2022",
    security: "none",
    uri: buildShadowsocksConnectionUri(input),
    params: {
      method: input.transport.method,
      serverKey: input.serverKey,
      userKey: input.userKey,
      address: input.transport.ipAddress,
      port: input.transport.port
    }
  };
}
