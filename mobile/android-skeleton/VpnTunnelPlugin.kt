// Draft sketch for Этап 2b — NOT part of any Gradle build, NOT compiled or tested.
// Lives outside android/ on purpose: there is no android/ platform project in this
// checkout yet (see ../README.md — `npx cap add android` was not run here).
//
// Once `npx cap add android` has been run, this becomes the starting point for
// android/app/src/main/java/com/simpledimple/app/VpnTunnelPlugin.kt.

package com.simpledimple.app

import android.content.Intent
import android.net.VpnService
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

@CapacitorPlugin(name = "VpnTunnel")
class VpnTunnelPlugin : Plugin() {

    @PluginMethod
    fun connect(call: PluginCall) {
        val config = call.getObject("config")
            ?: return call.reject("config is required")

        // TODO: parse config.params (uuid/address/port/flow/sni/fingerprint/publicKey/shortId)
        // into whatever the bundled Xray core expects (its own JSON config format,
        // not this VLESS URI/params shape one-to-one).
        //
        // TODO: request VpnService.prepare(context) first; if it returns non-null,
        // launch that Intent for user consent before starting the tunnel.
        //
        // TODO: start SimpleDimpleVpnService (below) with the parsed Xray config,
        // await confirmation the TUN interface is up, then resolve.

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

// TODO: implement as a real android.net.VpnService subclass.
// Responsibilities once implemented:
// - establish() a TUN interface (VpnService.Builder: addAddress/addRoute/addDnsServer)
// - hand the TUN file descriptor to the bundled Xray core process/library
// - keep the Xray core process alive as a foreground service (VPN services must be
//   foreground services on modern Android) and clean it up on stop
class SimpleDimpleVpnService : VpnService() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // TODO
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        // TODO: tear down Xray core process and the TUN interface
        super.onDestroy()
    }
}
