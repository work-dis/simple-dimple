// android.net.VpnService implementation for Этап 2b — see ../README.md.
// Source of truth: copy this file into
// android/app/src/main/java/com/simpledimple/app/SimpleDimpleVpnService.kt
// alongside VpnTunnelPlugin.kt (same package).
//
// Responsibilities:
// - establish() a TUN interface (VpnService.Builder)
// - hand the TUN fd to Xray-core via libXray (XTLS/libXray, gomobile-built
//   AAR — see mobile/README.md for the build command)
// - run as a foreground service (mandatory for VPN services on modern
//   Android) and clean up the TUN interface and Xray instance on stop
//
// Xray-core has a native "tun" inbound (proxy/tun, gVisor-based userspace
// network stack) that reads packets directly off the fd we hand it via
// LibXray.setTunFd() — see
// https://github.com/XTLS/Xray-core/blob/main/proxy/tun/README.md#android-support.
// No separate tun2socks bridge is needed.

package com.simpledimple.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.core.app.NotificationCompat
import libXray.DialerController
import libXray.LibXray
import org.json.JSONObject
import java.io.File
import java.util.Base64

class SimpleDimpleVpnService : VpnService() {

    private var tunInterface: ParcelFileDescriptor? = null

    private val vpnProtectController = object : DialerController {
        override fun protectFd(fd: Long): Boolean = protect(fd.toInt())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                val configPath = intent.getStringExtra(EXTRA_CONFIG_PATH)
                if (configPath == null) {
                    VpnTunnelPlugin.notifyTunnelStarted(false, "missing config path")
                    stopSelf()
                    return START_NOT_STICKY
                }
                startForeground(NOTIFICATION_ID, buildNotification())
                startTunnel(configPath)
            }
            ACTION_STOP -> stopTunnel()
            else -> Unit
        }
        return START_NOT_STICKY
    }

    private fun startTunnel(configPath: String) {
        if (isRunning || tunInterface != null) {
            // A previous attempt (e.g. from connectWithFallback() retrying
            // candidates) is still up — tear it down before starting a new
            // one, otherwise we leak Xray-core runtimes and tun fds and end
            // up with multiple parallel tun interfaces racing each other.
            stopRunningTunnel()
        }
        try {
            val configJson = File(configPath).readText()

            val builder = Builder()
                .setSession("Simple Dimple")
                .addAddress(TUN_ADDRESS, TUN_PREFIX_LENGTH)
                .addRoute("0.0.0.0", 0)
                .addRoute("::", 0)
                .addDnsServer(TUN_DNS)
                .setMtu(TUN_MTU)

            val pfd = builder.establish()
                ?: throw IllegalStateException("VpnService.Builder.establish() returned null — VPN permission not granted?")
            tunInterface = pfd

            LibXray.setTunFd(pfd.fd)

            // Without this, Xray-core's own outbound sockets (its connection to
            // the remote VLESS/REALITY server) get captured by the tun interface
            // we just established (addRoute("0.0.0.0", 0) routes ALL traffic,
            // including Xray-core's own process) — a self-loop where the dial to
            // the real server never actually leaves the device. VpnService.protect()
            // is the only way to exempt a raw fd from the tunnel; libXray calls
            // back into protectFd() for every socket it opens.
            LibXray.registerDialerController(vpnProtectController)
            LibXray.registerListenerController(vpnProtectController)

            val datDir = filesDir.absolutePath
            val requestBase64 = LibXray.newXrayRunFromJSONRequest(datDir, configJson)
            val response = decodeCallResponse(LibXray.runXrayFromJSON(requestBase64))

            if (response.optBoolean("success", false)) {
                isRunning = true
                VpnTunnelPlugin.notifyTunnelStarted(true, null)
            } else {
                val error = response.optString("error", "unknown error starting Xray")
                cleanupTunInterface()
                VpnTunnelPlugin.notifyTunnelStarted(false, error)
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }
        } catch (e: Exception) {
            cleanupTunInterface()
            VpnTunnelPlugin.notifyTunnelStarted(false, e.message ?: "failed to start tunnel")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
    }

    private fun stopTunnel() {
        val error = stopRunningTunnel()
        VpnTunnelPlugin.notifyTunnelStopped(error == null, error)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    /**
     * Stops the currently running Xray-core instance (if any) and tears down
     * the tun interface. Safe to call even if nothing is running. Does not
     * touch the foreground-service/notification state or call stopSelf() —
     * callers that are shutting the service down entirely still need to do
     * that themselves (see [stopTunnel]).
     */
    private fun stopRunningTunnel(): String? {
        var error: String? = null
        try {
            val response = decodeCallResponse(LibXray.stopXray())
            if (!response.optBoolean("success", false)) {
                error = response.optString("error", "unknown error stopping Xray")
            }
        } catch (e: Exception) {
            error = e.message
        } finally {
            cleanupTunInterface()
            isRunning = false
        }
        return error
    }

    private fun cleanupTunInterface() {
        try {
            tunInterface?.close()
        } catch (_: Exception) {
            // best-effort — the fd may already be closed if the process died mid-tunnel
        }
        tunInterface = null
    }

    override fun onDestroy() {
        cleanupTunInterface()
        isRunning = false
        super.onDestroy()
    }

    override fun onRevoke() {
        // User revoked VPN consent from system settings while we were connected.
        stopTunnel()
        super.onRevoke()
    }

    private fun decodeCallResponse(base64Text: String): JSONObject {
        val decoded = String(Base64.getDecoder().decode(base64Text))
        return JSONObject(decoded)
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIFICATION_CHANNEL_ID,
                "VPN Tunnel",
                NotificationManager.IMPORTANCE_LOW
            )
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
        }

        val contentIntent = packageManager.getLaunchIntentForPackage(packageName)?.let {
            PendingIntent.getActivity(
                this,
                0,
                it,
                PendingIntent.FLAG_IMMUTABLE
            )
        }

        return NotificationCompat.Builder(this, NOTIFICATION_CHANNEL_ID)
            .setContentTitle("Simple Dimple")
            .setContentText("VPN tunnel active")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .build()
    }

    companion object {
        const val ACTION_START = "com.simpledimple.app.action.START_TUNNEL"
        const val ACTION_STOP = "com.simpledimple.app.action.STOP_TUNNEL"
        const val EXTRA_CONFIG_PATH = "configPath"

        private const val NOTIFICATION_CHANNEL_ID = "vpn_tunnel"
        private const val NOTIFICATION_ID = 1001

        private const val TUN_ADDRESS = "10.10.14.1"
        private const val TUN_PREFIX_LENGTH = 30
        private const val TUN_DNS = "1.1.1.1"
        private const val TUN_MTU = 1500

        @Volatile
        var isRunning: Boolean = false
            private set
    }
}
