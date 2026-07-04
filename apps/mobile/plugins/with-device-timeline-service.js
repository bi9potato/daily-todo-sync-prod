const fs = require("fs");
const path = require("path");

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withMainApplication,
  withDangerousMod,
} = require("@expo/config-plugins");

const SERVICE_NAME = "DeviceTimelineService";
const BOOT_RECEIVER_NAME = "DeviceTimelineBootReceiver";
const SHUTDOWN_RECEIVER_NAME = "DeviceTimelineShutdownReceiver";
const PACKAGE_NAME = "com.dailytodosync.app";
const DEVICE_TIMELINE_PACKAGE_IMPORT = `${PACKAGE_NAME}.devicetimeline.DeviceTimelinePackage`;

function upsertImport(source, importLine) {
  if (source.includes(importLine)) {
    return source;
  }
  return source.replace(/^(package\s+[^\r\n]+\r?\n)/m, `$1\n${importLine}\n`);
}

function addUsesPermission(manifestConfig, permissionName) {
  const usesPermissions = (manifestConfig.modResults.manifest[
    "uses-permission"
  ] ??= []);
  if (
    !usesPermissions.some(
      (permission) => permission.$["android:name"] === permissionName,
    )
  ) {
    usesPermissions.push({ $: { "android:name": permissionName } });
  }
}

function withDeviceTimelineManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    addUsesPermission(
      manifestConfig,
      "android.permission.RECEIVE_BOOT_COMPLETED",
    );
    // Special permission: this only declares intent to use the API. It has
    // no runtime prompt - the user must flip it on manually in system
    // Settings > Usage access (see DeviceTimelineModule.openUsageAccessSettings),
    // same as every other on-device screen-time app.
    addUsesPermission(manifestConfig, "android.permission.PACKAGE_USAGE_STATS");
    // Since Android 14 (API 34) every foreground service type needs its own
    // matching android.permission.FOREGROUND_SERVICE_<TYPE> permission
    // declared, in addition to the plain FOREGROUND_SERVICE permission
    // (already declared via app.json for the mobility service's "location"
    // type). Missing this makes startForeground() throw
    // "requires permissions: ... FOREGROUND_SERVICE_DATA_SYNC" at runtime -
    // exactly the crash this service hit without it.
    addUsesPermission(
      manifestConfig,
      "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
    );

    const mainApplication = AndroidConfig.Manifest.getMainApplicationOrThrow(
      manifestConfig.modResults,
    );

    const services = (mainApplication.service ??= []);
    const serviceName = `.${SERVICE_NAME}`;
    const existingService = services.find(
      (service) => service.$["android:name"] === serviceName,
    );
    if (existingService) {
      existingService.$["android:exported"] = "false";
      existingService.$["android:foregroundServiceType"] = "dataSync";
    } else {
      services.push({
        $: {
          "android:name": serviceName,
          "android:exported": "false",
          "android:foregroundServiceType": "dataSync",
        },
      });
    }

    const receivers = (mainApplication.receiver ??= []);

    function upsertReceiver(name, actions) {
      const receiverName = `.${name}`;
      const existingReceiver = receivers.find(
        (receiver) => receiver.$["android:name"] === receiverName,
      );
      const receiver = existingReceiver ?? { $: {}, "intent-filter": [] };
      receiver.$["android:name"] = receiverName;
      receiver.$["android:enabled"] = "true";
      receiver.$["android:exported"] = "true";
      receiver["intent-filter"] = [
        { action: actions.map((action) => ({ $: { "android:name": action } })) },
      ];
      if (!existingReceiver) {
        receivers.push(receiver);
      }
    }

    upsertReceiver(BOOT_RECEIVER_NAME, [
      "android.intent.action.BOOT_COMPLETED",
      "android.intent.action.MY_PACKAGE_REPLACED",
    ]);
    // Best-effort only: Android does not guarantee ACTION_SHUTDOWN delivery
    // to third-party apps on every OEM, but it is one of the few implicit
    // broadcasts still deliverable to a manifest-declared receiver, and is
    // what every other battery/usage-tracking app relies on for the same
    // "log a shutdown marker" purpose.
    upsertReceiver(SHUTDOWN_RECEIVER_NAME, ["android.intent.action.ACTION_SHUTDOWN"]);

    return manifestConfig;
  });
}

function withDeviceTimelineMainApplication(config) {
  return withMainApplication(config, (mainApplicationConfig) => {
    if (mainApplicationConfig.modResults.language !== "kt") {
      throw new Error("Device timeline service expects MainApplication.kt.");
    }
    let source = mainApplicationConfig.modResults.contents;
    source = upsertImport(source, `import ${DEVICE_TIMELINE_PACKAGE_IMPORT}`);
    const packageLine = "add(DeviceTimelinePackage())";
    if (!source.includes(packageLine)) {
      source = source.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{\s*)/,
        `$1\n          ${packageLine}\n          `,
      );
    }
    if (!source.includes(packageLine)) {
      throw new Error("Could not register DeviceTimelinePackage.");
    }
    mainApplicationConfig.modResults.contents = source;
    return mainApplicationConfig;
  });
}

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === contents) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function withDeviceTimelineFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const sourceRoot = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "dailytodosync",
        "app",
      );
      const moduleRoot = path.join(sourceRoot, "devicetimeline");
      writeFileIfChanged(
        path.join(sourceRoot, `${SERVICE_NAME}.kt`),
        deviceTimelineServiceSource,
      );
      writeFileIfChanged(
        path.join(sourceRoot, `${BOOT_RECEIVER_NAME}.kt`),
        deviceTimelineBootReceiverSource,
      );
      writeFileIfChanged(
        path.join(sourceRoot, `${SHUTDOWN_RECEIVER_NAME}.kt`),
        deviceTimelineShutdownReceiverSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "DeviceTimelineModule.kt"),
        deviceTimelineModuleSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "DeviceTimelinePackage.kt"),
        deviceTimelinePackageSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "DeviceTimelineQueue.kt"),
        deviceTimelineQueueSource,
      );
      return modConfig;
    },
  ]);
}

function withDeviceTimeline(config) {
  return withDeviceTimelineFiles(
    withDeviceTimelineMainApplication(withDeviceTimelineManifest(config)),
  );
}

const deviceTimelinePackageSource = `package ${PACKAGE_NAME}.devicetimeline

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class DeviceTimelinePackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(DeviceTimelineModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

// Shared, dependency-free JSON-file queue used by the foreground service (to
// append events and flush them over HTTP), the boot receiver, and the
// shutdown receiver (both of which only need to append, never network - see
// their onReceive for why). Kept as a small standalone object rather than
// duplicating the read/trim/write logic across three separate classes.
const deviceTimelineQueueSource = `package ${PACKAGE_NAME}.devicetimeline

import android.content.Context
import java.io.File
import org.json.JSONArray
import org.json.JSONObject

object DeviceTimelineQueue {
  private const val QUEUE_FILE_NAME = "device-timeline-events.json"
  // A day at the polling cadence below produces on the order of a few
  // thousand events at most; this is a generous ceiling against a queue that
  // somehow never flushes (e.g. permanently offline).
  private const val MAX_QUEUED_EVENTS = 20_000
  private val queueLock = Any()

  private fun queueFile(context: Context): File {
    val directory = File(context.filesDir, "ExperienceData/${PACKAGE_NAME}")
    directory.mkdirs()
    return File(directory, QUEUE_FILE_NAME)
  }

  fun append(context: Context, event: JSONObject) {
    synchronized(queueLock) {
      val file = queueFile(context)
      val queue = try {
        JSONArray(file.readText())
      } catch (_: Throwable) {
        JSONArray()
      }
      queue.put(event)
      val overflow = queue.length() - MAX_QUEUED_EVENTS
      val trimmed = if (overflow > 0) {
        val kept = JSONArray()
        for (index in overflow until queue.length()) {
          kept.put(queue.getJSONObject(index))
        }
        kept
      } else {
        queue
      }
      file.writeText(trimmed.toString())
    }
  }

  fun readAll(context: Context): JSONArray {
    synchronized(queueLock) {
      return try {
        JSONArray(queueFile(context).readText())
      } catch (_: Throwable) {
        JSONArray()
      }
    }
  }

  fun removeFirst(context: Context, count: Int) {
    synchronized(queueLock) {
      val file = queueFile(context)
      val queue = try {
        JSONArray(file.readText())
      } catch (_: Throwable) {
        JSONArray()
      }
      if (count <= 0) return
      val remaining = JSONArray()
      for (index in count until queue.length()) {
        remaining.put(queue.getJSONObject(index))
      }
      file.writeText(remaining.toString())
    }
  }

  fun count(context: Context): Int = readAll(context).length()

  fun clear(context: Context) {
    synchronized(queueLock) {
      queueFile(context).writeText(JSONArray().toString())
    }
  }
}
`;

const deviceTimelineModuleSource = `package ${PACKAGE_NAME}.devicetimeline

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.dailytodosync.app.DeviceTimelineService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class DeviceTimelineModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "DeviceTimeline"

  @ReactMethod
  fun hasUsageAccess(promise: Promise) {
    promise.resolve(deviceHasUsageAccess(reactContext))
  }

  @ReactMethod
  fun openUsageAccessSettings(promise: Promise) {
    try {
      reactContext.startActivity(
        Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("device_timeline_usage_settings_failed", error)
    }
  }

  @ReactMethod
  fun start(apiBaseUrl: String, accessToken: String, promise: Promise) {
    try {
      if (!deviceHasUsageAccess(reactContext)) {
        promise.reject(
          "device_timeline_no_usage_access",
          "需要先在系统设置中开启“使用情况访问权限”才能记录时间线。",
        )
        return
      }
      val intent = Intent(reactContext, DeviceTimelineService::class.java).apply {
        action = DeviceTimelineService.ACTION_START
        putExtra(DeviceTimelineService.EXTRA_API_BASE_URL, apiBaseUrl)
        putExtra(DeviceTimelineService.EXTRA_ACCESS_TOKEN, accessToken)
      }
      ContextCompat.startForegroundService(reactContext, intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("device_timeline_start_failed", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      if (DeviceTimelineService.isRunning()) {
        reactContext.startService(
          Intent(reactContext, DeviceTimelineService::class.java).apply {
            action = DeviceTimelineService.ACTION_STOP
          },
        )
      } else {
        DeviceTimelineService.clearPersistedConfig(reactContext)
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("device_timeline_stop_failed", error)
    }
  }

  @ReactMethod
  fun updateAuth(accessToken: String, promise: Promise) {
    try {
      if (DeviceTimelineService.isRunning() && accessToken.isNotBlank()) {
        reactContext.startService(
          Intent(reactContext, DeviceTimelineService::class.java).apply {
            action = DeviceTimelineService.ACTION_UPDATE_AUTH
            putExtra(DeviceTimelineService.EXTRA_ACCESS_TOKEN, accessToken)
          },
        )
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("device_timeline_update_auth_failed", error)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(DeviceTimelineService.isRunning())
  }

  @ReactMethod
  fun getLastError(promise: Promise) {
    promise.resolve(DeviceTimelineService.getLastError())
  }

  @ReactMethod
  fun getQueuedEventCount(promise: Promise) {
    promise.resolve(DeviceTimelineQueue.count(reactContext))
  }

  @ReactMethod
  fun clearLocalQueue(promise: Promise) {
    try {
      DeviceTimelineQueue.clear(reactContext)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("device_timeline_clear_queue_failed", error)
    }
  }

  companion object {
    fun deviceHasUsageAccess(context: Context): Boolean {
      val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager
        ?: return false
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        appOps.unsafeCheckOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          context.packageName,
        )
      } else {
        @Suppress("DEPRECATION")
        appOps.checkOpNoThrow(
          AppOpsManager.OPSTR_GET_USAGE_STATS,
          android.os.Process.myUid(),
          context.packageName,
        )
      }
      return mode == AppOpsManager.MODE_ALLOWED
    }
  }
}
`;

const deviceTimelineServiceSource = `package ${PACKAGE_NAME}

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import androidx.core.content.ContextCompat
import com.dailytodosync.app.devicetimeline.DeviceTimelineModule
import com.dailytodosync.app.devicetimeline.DeviceTimelineQueue
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread
import org.json.JSONArray
import org.json.JSONObject

/**
 * Watches which app is in the foreground (via [UsageStatsManager], the
 * documented API every on-device screen-time/digital-wellbeing app is built
 * on - there is no push notification for "foreground app changed", so it is
 * polled) and screen lock/unlock, appending a chronological event stream to
 * [DeviceTimelineQueue] and periodically flushing it to the backend. Modeled
 * directly on NativeMobilityService's foreground-service + local-queue
 * pattern.
 */
class DeviceTimelineService : Service() {
  private var running = false
  private var apiBaseUrl = ""
  private var accessToken = ""
  private var uploadThread: Thread? = null
  private var pollThread: HandlerThread? = null
  private var pollHandler: Handler? = null
  private var lastEventQueryTime = 0L
  private var lastForegroundPackage: String? = null
  private var lastHeartbeatAt = 0L
  private var screenReceiverRegistered = false

  private val screenStateReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
      when (intent.action) {
        Intent.ACTION_SCREEN_OFF -> {
          enqueue(EVENT_SCREEN_OFF, null, null)
          stopPolling()
          scheduleUpload()
        }
        Intent.ACTION_SCREEN_ON -> {
          enqueue(EVENT_SCREEN_ON, null, null)
          startPolling()
        }
        Intent.ACTION_USER_PRESENT -> {
          enqueue(EVENT_UNLOCK, null, null)
          scheduleUpload()
        }
      }
    }
  }

  override fun onCreate() {
    super.onCreate()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      when (intent?.action) {
        ACTION_START -> {
          apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL).orEmpty().trimEnd('/')
          accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty()
          persistConfig()
          startTracking()
        }
        ACTION_STOP -> stopTracking()
        ACTION_UPDATE_AUTH -> {
          val nextToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty()
          if (running && nextToken.isNotBlank()) {
            accessToken = nextToken
            persistConfig()
            scheduleUpload()
          } else if (!running) {
            stopSelf()
          }
        }
        else -> {
          restoreConfig()
          if (apiBaseUrl.isNotBlank() && accessToken.isNotBlank()) startTracking() else stopSelf()
        }
      }
    } catch (error: Throwable) {
      failAndStop("启动设备时间线服务失败", error)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  // Android 15+ caps a "dataSync" foreground service at roughly 6 cumulative
  // hours per rolling 24h window; once hit, the OS calls this instead of
  // just killing the process. The documented mitigation for a service that
  // legitimately needs to keep running all day is exactly this: stop the
  // current foreground state and immediately request a fresh one, which
  // resets the window.
  override fun onTimeout(startId: Int, fgsType: Int) {
    val restartApiBaseUrl = apiBaseUrl
    val restartAccessToken = accessToken
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf(startId)
    if (restartApiBaseUrl.isNotBlank() && restartAccessToken.isNotBlank()) {
      ContextCompat.startForegroundService(
        applicationContext,
        Intent(applicationContext, DeviceTimelineService::class.java).apply {
          action = ACTION_START
          putExtra(EXTRA_API_BASE_URL, restartApiBaseUrl)
          putExtra(EXTRA_ACCESS_TOKEN, restartAccessToken)
        },
      )
    }
  }

  override fun onDestroy() {
    try {
      stopPolling()
      unregisterScreenReceiver()
    } catch (_: Throwable) {
      // Destruction must never bring down the host process.
    }
    serviceRunning = false
    running = false
    super.onDestroy()
  }

  private fun startTracking() {
    if (apiBaseUrl.isBlank() || accessToken.isBlank()) {
      setLastError("设备时间线服务缺少登录信息。")
      stopSelf()
      return
    }
    startForegroundNotification()
    running = true
    serviceRunning = true
    setLastError("")
    registerScreenReceiver()
    // The service can be (re)started with the screen already on (e.g. after
    // an app-triggered restart), so pick polling back up immediately rather
    // than waiting for the next ACTION_SCREEN_ON.
    startPolling()
    scheduleUpload()
  }

  private fun stopTracking() {
    running = false
    serviceRunning = false
    stopPolling()
    unregisterScreenReceiver()
    scheduleUpload()
    clearConfig()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun registerScreenReceiver() {
    if (screenReceiverRegistered) return
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    // SCREEN_ON/OFF/USER_PRESENT are implicit broadcasts Android only
    // delivers to a receiver registered at runtime, never to one declared in
    // the manifest - this is why the service (not the manifest) owns them.
    registerReceiver(screenStateReceiver, filter)
    screenReceiverRegistered = true
  }

  private fun unregisterScreenReceiver() {
    if (!screenReceiverRegistered) return
    try {
      unregisterReceiver(screenStateReceiver)
    } catch (_: Throwable) {
      // Already unregistered (e.g. process death raced this call).
    }
    screenReceiverRegistered = false
  }

  private fun startPolling() {
    if (pollThread != null) return
    val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
    if (powerManager?.isInteractive == false) return
    // Query a short lookback on service start so the app already in front is
    // discovered immediately instead of waiting for the next app switch.
    lastEventQueryTime = System.currentTimeMillis() - EVENT_LOOKBACK_MS
    val handlerThread = HandlerThread("DeviceTimelinePoll").apply { start() }
    pollThread = handlerThread
    val handler = Handler(handlerThread.looper)
    pollHandler = handler
    val poll = object : Runnable {
      override fun run() {
        pollForegroundApp()
        handler.postDelayed(this, POLL_INTERVAL_MS)
      }
    }
    handler.post(poll)
  }

  private fun stopPolling() {
    pollHandler?.removeCallbacksAndMessages(null)
    pollHandler = null
    pollThread?.quitSafely()
    pollThread = null
    lastForegroundPackage = null
    lastHeartbeatAt = 0L
  }

  private fun pollForegroundApp() {
    try {
      val usageStatsManager =
        getSystemService(Context.USAGE_STATS_SERVICE) as? UsageStatsManager ?: return
      val now = System.currentTimeMillis()
      val events = usageStatsManager.queryEvents(lastEventQueryTime, now)
      lastEventQueryTime = now
      val event = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(event)
        // ACTIVITY_RESUMED is the documented API 29+ name for the legacy
        // MOVE_TO_FOREGROUND value and carries the real transition time.
        if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
          val foregroundPackage = event.packageName ?: continue
          if (foregroundPackage != lastForegroundPackage) {
            lastForegroundPackage = foregroundPackage
            lastHeartbeatAt = event.timeStamp
            enqueue(
              EVENT_APP_FOREGROUND,
              foregroundPackage,
              resolveAppLabel(foregroundPackage),
              event.timeStamp,
            )
            scheduleUpload()
          }
        }
      }
      // A minute heartbeat bounds the error for a still-open app segment and
      // lets the server report useful totals before the next app switch.
      val currentPackage = lastForegroundPackage
      if (currentPackage != null && now - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatAt = now
        enqueue(EVENT_APP_FOREGROUND, currentPackage, resolveAppLabel(currentPackage), now)
        scheduleUpload()
      }
    } catch (error: Throwable) {
      setLastError("读取前台应用失败：\${error.message ?: error.javaClass.simpleName}")
    }
  }

  private fun resolveAppLabel(packageName: String): String {
    return try {
      val appInfo = packageManager.getApplicationInfo(packageName, 0)
      packageManager.getApplicationLabel(appInfo).toString()
    } catch (_: Throwable) {
      packageName
    }
  }

  private fun enqueue(
    eventType: String,
    packageName: String?,
    appLabel: String?,
    occurredAtMillis: Long = System.currentTimeMillis(),
  ) {
    try {
      val recordedAt = ISO_FORMAT.get().format(Date(occurredAtMillis))
      val event = JSONObject()
        .put("clientId", "native-\${eventType}-\${occurredAtMillis}-\${random.nextInt(1_000_000)}")
        .put("eventType", eventType)
        .put("occurredAt", recordedAt)
        .put("packageName", packageName ?: "")
        .put("appLabel", appLabel ?: "")
      DeviceTimelineQueue.append(applicationContext, event)
    } catch (error: Throwable) {
      setLastError("记录设备时间线事件失败：\${error.message ?: error.javaClass.simpleName}")
    }
  }

  private fun scheduleUpload() {
    if (uploadThread?.isAlive == true) return
    uploadThread = thread(name = "DeviceTimelineUpload") { flushQueue() }
  }

  private fun flushQueue() {
    if (apiBaseUrl.isBlank() || accessToken.isBlank()) return
    val queue = DeviceTimelineQueue.readAll(applicationContext)
    if (queue.length() == 0) return
    var offset = 0
    while (offset < queue.length()) {
      val end = minOf(offset + MAX_UPLOAD_EVENTS, queue.length())
      val chunk = JSONArray()
      for (index in offset until end) {
        chunk.put(queue.getJSONObject(index))
      }
      val status = uploadEvents(chunk)
      if (status !in 200..299 && status != 404) {
        if (status == 401) {
          setLastError("设备时间线上传凭证已过期，请打开应用一次以刷新授权。")
        }
        break
      }
      offset = end
    }
    if (offset > 0) {
      DeviceTimelineQueue.removeFirst(applicationContext, offset)
    }
  }

  private fun uploadEvents(events: JSONArray): Int {
    return try {
      val url = URL("\${apiBaseUrl}/device-timeline/events")
      val body = JSONObject().put("events", events).toString()
      val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = NETWORK_TIMEOUT_MS
        readTimeout = NETWORK_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer \${accessToken}")
        setRequestProperty("Content-Type", "application/json")
      }
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val status = connection.responseCode
      if (status in 200..299) connection.inputStream?.close() else connection.errorStream?.close()
      connection.disconnect()
      status
    } catch (_: Throwable) {
      -1
    }
  }

  private fun startForegroundNotification() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        buildNotification(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC,
      )
    } else {
      startForeground(NOTIFICATION_ID, buildNotification())
    }
  }

  private fun buildNotification(): Notification {
    ensureNotificationChannel()
    val launchIntent =
      packageManager.getLaunchIntentForPackage(packageName) ?: Intent(this, MainActivity::class.java)
    val pendingIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    @Suppress("DEPRECATION")
    return builder
      .setSmallIcon(R.drawable.location_foreground_service_icon)
      .setContentTitle("Daily Todo 正在记录设备时间线")
      .setContentText("正在记录锁屏/开机与应用使用情况，事件会先保存到本地并定时上传。")
      .setContentIntent(pendingIntent)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(Notification.PRIORITY_LOW)
      .build()
  }

  private fun ensureNotificationChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java)
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "Daily Todo 设备时间线",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "持续记录设备时间线时显示的通知"
      },
    )
  }

  private fun failAndStop(prefix: String, error: Throwable) {
    running = false
    serviceRunning = false
    setLastError("\${prefix}：\${error.message ?: error.javaClass.simpleName}")
    try {
      stopSelf()
    } catch (_: Throwable) {
      // The original failure is retained for the JS diagnostics.
    }
  }

  private fun persistConfig() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putString("apiBaseUrl", apiBaseUrl)
      .putString("accessToken", accessToken)
      .apply()
  }

  private fun restoreConfig() {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    apiBaseUrl = prefs.getString("apiBaseUrl", "").orEmpty()
    accessToken = prefs.getString("accessToken", "").orEmpty()
  }

  private fun clearConfig() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
  }

  companion object {
    const val ACTION_START = "${PACKAGE_NAME}.devicetimeline.START"
    const val ACTION_STOP = "${PACKAGE_NAME}.devicetimeline.STOP"
    const val ACTION_UPDATE_AUTH = "${PACKAGE_NAME}.devicetimeline.UPDATE_AUTH"
    const val EXTRA_API_BASE_URL = "apiBaseUrl"
    const val EXTRA_ACCESS_TOKEN = "accessToken"
    const val EVENT_APP_FOREGROUND = "app_foreground"
    const val EVENT_SCREEN_ON = "screen_on"
    const val EVENT_SCREEN_OFF = "screen_off"
    const val EVENT_UNLOCK = "unlock"
    private const val CHANNEL_ID = "daily_todo_device_timeline"
    private const val NOTIFICATION_ID = 4308
    // How often the foreground-app poll runs while the screen is on. Real
    // usage-tracking apps use a similar few-second cadence; polling stops
    // outright while the screen is off (see the screen-state receiver) since
    // there is nothing meaningful to attribute foreground time to then.
    private const val POLL_INTERVAL_MS = 4_000L
    private const val HEARTBEAT_INTERVAL_MS = 60_000L
    private const val EVENT_LOOKBACK_MS = 5 * 60_000L
    private const val MAX_UPLOAD_EVENTS = 200
    private const val NETWORK_TIMEOUT_MS = 15_000
    private const val PREFS_NAME = "daily_todo_device_timeline"
    private val random = SecureRandom()
    @Volatile private var serviceRunning = false
    @Volatile private var lastError = ""
    private val ISO_FORMAT = ThreadLocal.withInitial {
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
    }

    fun isRunning(): Boolean = serviceRunning

    fun getLastError(): String = lastError

    private fun setLastError(message: String) {
      lastError = message
    }

    fun clearPersistedConfig(context: Context) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .apply()
      serviceRunning = false
    }

    fun restartPersisted(context: Context): Boolean {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val persistedApiBaseUrl = prefs.getString("apiBaseUrl", "").orEmpty()
      val persistedAccessToken = prefs.getString("accessToken", "").orEmpty()
      if (persistedApiBaseUrl.isBlank() || persistedAccessToken.isBlank()) {
        return false
      }
      if (!DeviceTimelineModule.deviceHasUsageAccess(context)) {
        return false
      }
      ContextCompat.startForegroundService(
        context,
        Intent(context, DeviceTimelineService::class.java).apply {
          action = ACTION_START
          putExtra(EXTRA_API_BASE_URL, persistedApiBaseUrl)
          putExtra(EXTRA_ACCESS_TOKEN, persistedAccessToken)
        },
      )
      return true
    }
  }
}
`;

const deviceTimelineBootReceiverSource = `package ${PACKAGE_NAME}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dailytodosync.app.devicetimeline.DeviceTimelineQueue
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

class DeviceTimelineBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (
      intent.action != Intent.ACTION_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      return
    }
    try {
      if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
        val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
          timeZone = TimeZone.getTimeZone("UTC")
        }
        DeviceTimelineQueue.append(
          context.applicationContext,
          JSONObject()
            .put("clientId", "native-boot-\${System.currentTimeMillis()}")
            .put("eventType", "boot")
            .put("occurredAt", format.format(Date()))
            .put("packageName", "")
            .put("appLabel", ""),
        )
      }
      DeviceTimelineService.restartPersisted(context)
    } catch (_: Throwable) {
      // Android may temporarily reject a foreground-service restart. Opening
      // the app will retry through the normal runtime reconciliation path.
    }
  }
}
`;

const deviceTimelineShutdownReceiverSource = `package ${PACKAGE_NAME}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.dailytodosync.app.devicetimeline.DeviceTimelineQueue
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import org.json.JSONObject

/**
 * ACTION_SHUTDOWN gives a receiver almost no time budget before the process
 * is torn down, and Android does not guarantee delivery to third-party apps
 * at all on every OEM - so this only appends a local record synchronously
 * (no network call, which could easily lose the race). It uploads on the
 * next boot/service start like any other queued event.
 */
class DeviceTimelineShutdownReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_SHUTDOWN) return
    try {
      val format = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
      DeviceTimelineQueue.append(
        context.applicationContext,
        JSONObject()
          .put("clientId", "native-shutdown-\${System.currentTimeMillis()}")
          .put("eventType", "shutdown")
          .put("occurredAt", format.format(Date()))
          .put("packageName", "")
          .put("appLabel", ""),
      )
    } catch (_: Throwable) {
      // Best effort only, per the class doc above.
    }
  }
}
`;

module.exports = createRunOncePlugin(
  withDeviceTimeline,
  "daily-todo-device-timeline",
  "1.0.0",
);
