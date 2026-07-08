// Draft sketch for Этап 2b — NOT part of any Gradle build, NOT compiled or tested.
// Lives outside android/ on purpose: there is no android/ platform project in this
// checkout yet (see ../README.md — `npx cap add android` was not run here).
//
// Once `npx cap add android` has been run, this becomes the starting point for
// android/app/src/main/java/com/simpledimple/app/VpnTunnelPlugin.kt. The JS-side
// contract it implements lives in frontend/src/lib/vpnTunnel.ts (not mobile/) —
// Capacitor bundles frontend/dist as its webDir, so that's the code that actually
// ships and calls into this plugin by name ("VpnTunnel").

package com.simpledimple.app

import android.app.Activity
import android.net.VpnService
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "VpnTunnel")
class VpnTunnelPlugin : Plugin() {

    @PluginMethod
    fun connect(call: PluginCall) {
        val tunnelParams = parseTunnelParams(call) ?: return

        // Android VPN consent: VpnService.prepare() returns a non-null Intent the
        // first time (or after the user revokes a prior grant) an app on this
        // device requests VPN access. That Intent has to be launched for the user
        // to approve before any tunnel can come up; startActivityForResult here is
        // Capacitor's own call-persisting helper, so `call` is handed back as-is
        // to the @ActivityCallback method below once the user responds.
        val consentIntent = VpnService.prepare(context)
        if (consentIntent != null) {
            startActivityForResult(call, consentIntent, "onVpnConsentResult")
            return
        }

        startTunnel(call, tunnelParams)
    }

    @ActivityCallback
    private fun onVpnConsentResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) {
            // Capacitor could not restore the original call (e.g. process was
            // killed while the consent activity was open) — nothing to resolve.
            return
        }

        if (result.resultCode != Activity.RESULT_OK) {
            call.reject("User declined the VPN permission request")
            return
        }

        val tunnelParams = parseTunnelParams(call) ?: return
        startTunnel(call, tunnelParams)
    }

    // config shape is ConnectionConfigSummary from frontend/src/types — top-level
    // uri/endpointId/protocol/security plus a nested `params` object with the
    // actual VLESS+REALITY fields.
    private fun parseTunnelParams(call: PluginCall): TunnelParams? {
        val config = call.getObject("config")
        if (config == null) {
            call.reject("config is required")
            return null
        }

        val params = config.getJSObject("params")
        if (params == null) {
            call.reject("config.params is required")
            return null
        }

        val tunnelParams = TunnelParams(
            uuid = params.optString("uuid", ""),
            address = params.optString("address", ""),
            port = params.optInt("port", 0),
            flow = params.optString("flow", ""),
            sni = params.optString("sni", ""),
            fingerprint = params.optString("fingerprint", ""),
            publicKey = params.optString("publicKey", ""),
            shortId = params.optString("shortId", "")
        )

        if (tunnelParams.address.isEmpty() || tunnelParams.port == 0) {
            call.reject("config.params.address and config.params.port are required")
            return null
        }

        return tunnelParams
    }

    private fun startTunnel(call: PluginCall, tunnelParams: TunnelParams) {
        // TODO: once a mobile Xray core library is chosen (JNI .so bundle or an
        // AAR wrapper — that choice is a separate decision, not made here),
        // translate tunnelParams into that library's own config format (it will
        // not be a 1:1 mapping onto the VLESS URI shape), start
        // SimpleDimpleVpnService with it, wait for confirmation the TUN interface
        // is up, then resolve.
        call.reject("not implemented — draft skeleton, see mobile/README.md")
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        // TODO: stop SimpleDimpleVpnService / tear down the TUN interface.
        call.reject("not implemented — draft skeleton, see mobile/README.md")
    }

    @PluginMethod
    fun status(call: PluginCall) {
        val result = JSObject()
        result.put("status", "disconnected")
        call.resolve(result)
    }
}

private data class TunnelParams(
    val uuid: String,
    val address: String,
    val port: Int,
    val flow: String,
    val sni: String,
    val fingerprint: String,
    val publicKey: String,
    val shortId: String
)

// TODO: implement as a real android.net.VpnService subclass.
// Responsibilities once implemented:
// - establish() a TUN interface (VpnService.Builder: addAddress/addRoute/addDnsServer)
// - hand the TUN file descriptor to the bundled Xray core process/library
// - keep the Xray core process alive as a foreground service (VPN services must be
//   foreground services on modern Android) and clean it up on stop
class SimpleDimpleVpnService : android.net.VpnService() {
    override fun onStartCommand(intent: android.content.Intent?, flags: Int, startId: Int): Int {
        // TODO
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        // TODO: tear down Xray core process and the TUN interface
        super.onDestroy()
    }
}
