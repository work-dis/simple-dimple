// Draft plugin surface for Этап 2b — see ../../README.md.
// Not wired to a native implementation yet: android-skeleton/VpnTunnelPlugin.kt
// is a sketch, not a registered Capacitor plugin.

export type VlessRealityConnectionConfig = {
  endpointId: string;
  protocol: "vless";
  security: "reality";
  uri: string;
  params: {
    uuid: string;
    address: string;
    port: number;
    flow: string;
    sni: string;
    fingerprint: string;
    publicKey: string;
    shortId: string;
  };
};

export type VpnTunnelStatus = "disconnected" | "connecting" | "connected" | "error";

export interface VpnTunnelPlugin {
  connect(options: { config: VlessRealityConnectionConfig }): Promise<{ status: VpnTunnelStatus }>;
  disconnect(): Promise<{ status: VpnTunnelStatus }>;
  status(): Promise<{ status: VpnTunnelStatus }>;
}
