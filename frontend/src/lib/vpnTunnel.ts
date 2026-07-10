import { Capacitor, registerPlugin } from "@capacitor/core";

import type { ConnectionConfigSummary } from "../types";

export type VpnTunnelStatus = "disconnected" | "connecting" | "connected" | "error";

// JS-side contract for the native tunnel plugin (Этап 2b,
// PRIORITY_PLAN.md). Registered here — not in mobile/ — because Capacitor
// bundles `frontend/dist` as its webDir (mobile/capacitor.config.ts), so this
// is the code that actually ships inside the native shell. mobile/ only holds
// the Capacitor project scaffold and the native Kotlin skeleton
// (mobile/android-skeleton/VpnTunnelPlugin.kt) that this contract targets.
export interface VpnTunnelPlugin {
  connect(options: { config: ConnectionConfigSummary }): Promise<{ status: VpnTunnelStatus }>;
  disconnect(): Promise<{ status: VpnTunnelStatus }>;
  status(): Promise<{ status: VpnTunnelStatus }>;
}

const vpnTunnel = registerPlugin<VpnTunnelPlugin>("VpnTunnel");

// True only inside the Capacitor-wrapped native shell. Always false in the
// plain PWA/browser context — there is no native plugin to call there, and
// registerPlugin's web fallback would otherwise throw "not implemented".
export function isNativeTunnelAvailable() {
  return Capacitor.isNativePlatform();
}

// Best-effort native tunnel calls: the PWA control-plane (session.status in
// the DB, per Decision 021) stays the source of truth regardless of whether
// the native call succeeds, so failures here are reported but never thrown
// into the caller's connect/disconnect flow.
export async function connectNativeTunnel(
  config: ConnectionConfigSummary,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isNativeTunnelAvailable()) {
    return { ok: false, error: "native tunnel not available in this environment" };
  }

  try {
    await vpnTunnel.connect({ config });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown native tunnel error" };
  }
}

export async function disconnectNativeTunnel(): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isNativeTunnelAvailable()) {
    return { ok: false, error: "native tunnel not available in this environment" };
  }

  try {
    await vpnTunnel.disconnect();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown native tunnel error" };
  }
}

// disconnect() resolving isn't proof the OS tore the tunnel down — a teardown
// race (see Decision 035/036, DECISIONS.md) can leave the native side still
// "connected" while the JS call reports success. Ask the plugin directly
// instead of trusting the disconnect() resolution alone.
export async function getNativeTunnelStatus(): Promise<VpnTunnelStatus | null> {
  if (!isNativeTunnelAvailable()) {
    return null;
  }

  try {
    const result = await vpnTunnel.status();
    return result.status;
  } catch {
    return null;
  }
}
