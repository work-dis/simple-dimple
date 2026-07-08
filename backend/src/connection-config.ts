import type { ConnectionConfigSummary } from "./types.js";

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
}): ConnectionConfigSummary {
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
