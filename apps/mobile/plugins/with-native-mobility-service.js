const fs = require("fs");
const path = require("path");

const {
  AndroidConfig,
  createRunOncePlugin,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const SERVICE_NAME = "NativeMobilityService";
const BOOT_RECEIVER_NAME = "NativeMobilityBootReceiver";
const ACTIVITY_RECEIVER_NAME = "NativeMobilityActivityReceiver";
const PACKAGE_NAME = "com.dailytodosync.app";
const MOBILITY_PACKAGE_IMPORT = `${PACKAGE_NAME}.mobility.NativeMobilityPackage`;
const PLAY_SERVICES_LOCATION =
  'implementation("com.google.android.gms:play-services-location:21.0.1")';

function upsertImport(source, importLine) {
  if (source.includes(importLine)) {
    return source;
  }
  return source.replace(/^(package\s+[^\r\n]+\r?\n)/m, `$1\n${importLine}\n`);
}

function withNativeMobilityManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const usesPermissions = (manifestConfig.modResults.manifest[
      "uses-permission"
    ] ??= []);
    if (
      !usesPermissions.some(
        (permission) =>
          permission.$["android:name"] ===
          "android.permission.RECEIVE_BOOT_COMPLETED",
      )
    ) {
      usesPermissions.push({
        $: { "android:name": "android.permission.RECEIVE_BOOT_COMPLETED" },
      });
    }
    if (
      !usesPermissions.some(
        (permission) =>
          permission.$["android:name"] ===
          "com.google.android.gms.permission.ACTIVITY_RECOGNITION",
      )
    ) {
      usesPermissions.push({
        $: {
          "android:name":
            "com.google.android.gms.permission.ACTIVITY_RECOGNITION",
        },
      });
    }
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
      existingService.$["android:foregroundServiceType"] = "location";
    } else {
      services.push({
        $: {
          "android:name": serviceName,
          "android:exported": "false",
          "android:foregroundServiceType": "location",
        },
      });
    }
    const receivers = (mainApplication.receiver ??= []);
    const receiverName = `.${BOOT_RECEIVER_NAME}`;
    const existingReceiver = receivers.find(
      (receiver) => receiver.$["android:name"] === receiverName,
    );
    const receiver = existingReceiver ?? {
      $: {},
      "intent-filter": [],
    };
    receiver.$["android:name"] = receiverName;
    receiver.$["android:enabled"] = "true";
    receiver.$["android:exported"] = "true";
    receiver["intent-filter"] = [
      {
        action: [
          { $: { "android:name": "android.intent.action.BOOT_COMPLETED" } },
          {
            $: {
              "android:name": "android.intent.action.MY_PACKAGE_REPLACED",
            },
          },
        ],
      },
    ];
    if (!existingReceiver) {
      receivers.push(receiver);
    }
    const activityReceiverName = `.${ACTIVITY_RECEIVER_NAME}`;
    const existingActivityReceiver = receivers.find(
      (item) => item.$["android:name"] === activityReceiverName,
    );
    if (existingActivityReceiver) {
      existingActivityReceiver.$["android:exported"] = "false";
    } else {
      receivers.push({
        $: {
          "android:name": activityReceiverName,
          "android:enabled": "true",
          "android:exported": "false",
        },
      });
    }
    return manifestConfig;
  });
}

function withNativeMobilityMainApplication(config) {
  return withMainApplication(config, (mainApplicationConfig) => {
    if (mainApplicationConfig.modResults.language !== "kt") {
      throw new Error("Native mobility service expects MainApplication.kt.");
    }
    let source = mainApplicationConfig.modResults.contents;
    source = upsertImport(source, `import ${MOBILITY_PACKAGE_IMPORT}`);
    const packageLine = "add(NativeMobilityPackage())";
    if (!source.includes(packageLine)) {
      source = source.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{\s*)/,
        `$1\n          ${packageLine}\n          `,
      );
    }
    source = source.replace(
      `${packageLine}// Packages`,
      `${packageLine}\n          // Packages`,
    );
    if (!source.includes(packageLine)) {
      throw new Error("Could not register NativeMobilityPackage.");
    }
    mainApplicationConfig.modResults.contents = source;
    return mainApplicationConfig;
  });
}

function withNativeMobilityDependency(config) {
  return withAppBuildGradle(config, (buildGradleConfig) => {
    if (buildGradleConfig.modResults.language !== "groovy") {
      throw new Error("Native mobility service expects app/build.gradle Groovy.");
    }
    let source = buildGradleConfig.modResults.contents;
    if (!source.includes(PLAY_SERVICES_LOCATION)) {
      source = source.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${PLAY_SERVICES_LOCATION}`,
      );
    }
    buildGradleConfig.modResults.contents = source;
    return buildGradleConfig;
  });
}

function writeFileIfChanged(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === contents) {
    return;
  }
  fs.writeFileSync(filePath, contents);
}

function withNativeMobilityFiles(config) {
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
      const mobilityRoot = path.join(sourceRoot, "mobility");
      writeFileIfChanged(
        path.join(sourceRoot, `${SERVICE_NAME}.kt`),
        nativeMobilityServiceSource,
      );
      writeFileIfChanged(
        path.join(sourceRoot, `${BOOT_RECEIVER_NAME}.kt`),
        nativeMobilityBootReceiverSource,
      );
      writeFileIfChanged(
        path.join(sourceRoot, `${ACTIVITY_RECEIVER_NAME}.kt`),
        nativeMobilityActivityReceiverSource,
      );
      writeFileIfChanged(
        path.join(mobilityRoot, "NativeMobilityModule.kt"),
        nativeMobilityModuleSource,
      );
      writeFileIfChanged(
        path.join(mobilityRoot, "NativeMobilityPackage.kt"),
        nativeMobilityPackageSource,
      );
      return modConfig;
    },
  ]);
}

function withNativeMobility(config) {
  return withNativeMobilityFiles(
    withNativeMobilityDependency(
      withNativeMobilityMainApplication(withNativeMobilityManifest(config)),
    ),
  );
}

const nativeMobilityPackageSource = `package ${PACKAGE_NAME}.mobility

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class NativeMobilityPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(NativeMobilityModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

const nativeMobilityModuleSource = `package ${PACKAGE_NAME}.mobility

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import com.dailytodosync.app.NativeMobilityService
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class NativeMobilityModule(
  private val reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "NativeMobility"

  @ReactMethod
  fun start(recordingId: String, apiBaseUrl: String, accessToken: String, promise: Promise) {
    try {
      val activity = reactContext.currentActivity
      if (
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
        (activity == null || activity.isFinishing || !activity.hasWindowFocus())
      ) {
        promise.reject(
          "native_mobility_activity_not_visible",
          "足迹服务只能在应用授权页面完全关闭后启动，请返回应用重试。",
        )
        return
      }
      val intent = Intent(reactContext, NativeMobilityService::class.java).apply {
        action = NativeMobilityService.ACTION_START
        putExtra(NativeMobilityService.EXTRA_RECORDING_ID, recordingId)
        putExtra(NativeMobilityService.EXTRA_API_BASE_URL, apiBaseUrl)
        putExtra(NativeMobilityService.EXTRA_ACCESS_TOKEN, accessToken)
      }
      NativeMobilityService.prepareForStart(recordingId)
      ContextCompat.startForegroundService(activity ?: reactContext, intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("native_mobility_start_failed", error)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      if (NativeMobilityService.isRunning()) {
        ContextCompat.startForegroundService(
          reactContext.currentActivity ?: reactContext,
          Intent(reactContext, NativeMobilityService::class.java).apply {
            action = NativeMobilityService.ACTION_STOP
          },
        )
      } else {
        NativeMobilityService.clearPersistedConfig(reactContext)
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("native_mobility_stop_failed", error)
    }
  }

  @ReactMethod
  fun updateAuth(accessToken: String, promise: Promise) {
    try {
      if (NativeMobilityService.isRunning() && accessToken.isNotBlank()) {
        // Plain startService: the target is already a started foreground
        // service, so this only delivers the command; it must not use
        // startForegroundService, whose start-within-5s contract would
        // apply if the service happened to have just died.
        reactContext.startService(
          Intent(reactContext, NativeMobilityService::class.java).apply {
            action = NativeMobilityService.ACTION_UPDATE_AUTH
            putExtra(NativeMobilityService.EXTRA_ACCESS_TOKEN, accessToken)
          },
        )
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("native_mobility_update_auth_failed", error)
    }
  }

  @ReactMethod
  fun flushQueueNow(promise: Promise) {
    try {
      if (NativeMobilityService.isRunning()) {
        reactContext.startService(
          Intent(reactContext, NativeMobilityService::class.java).apply {
            action = NativeMobilityService.ACTION_FLUSH
          },
        )
      }
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("native_mobility_flush_failed", error)
    }
  }

  @ReactMethod
  fun isRunning(promise: Promise) {
    promise.resolve(NativeMobilityService.isRunning())
  }

  @ReactMethod
  fun isStepTrackingActive(promise: Promise) {
    promise.resolve(NativeMobilityService.isStepTrackingActive())
  }

  @ReactMethod
  fun getLastError(promise: Promise) {
    promise.resolve(NativeMobilityService.getLastError())
  }

  @ReactMethod
  fun getLatestPoint(promise: Promise) {
    promise.resolve(NativeMobilityService.getLatestPoint())
  }

  @ReactMethod
  fun isBatteryOptimizationDisabled(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }
    val powerManager = reactContext.getSystemService(PowerManager::class.java)
    promise.resolve(
      powerManager?.isIgnoringBatteryOptimizations(reactContext.packageName) == true,
    )
  }

  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    try {
      val settingsIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val fallbackIntent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:\${reactContext.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val intent =
        if (settingsIntent.resolveActivity(reactContext.packageManager) != null) {
          settingsIntent
        } else {
          fallbackIntent
        }
      (reactContext.currentActivity ?: reactContext).startActivity(intent)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("battery_optimization_settings_failed", error)
    }
  }

  @ReactMethod
  fun getQueuedPointCount(promise: Promise) {
    promise.resolve(NativeMobilityService.getQueuedPointCount(reactContext))
  }

  @ReactMethod
  fun clearLocalQueue(promise: Promise) {
    try {
      NativeMobilityService.clearLocalQueue(reactContext)
      promise.resolve(true)
    } catch (error: Throwable) {
      promise.reject("native_mobility_clear_queue_failed", error)
    }
  }
}
`;

const nativeMobilityServiceSource = `package ${PACKAGE_NAME}

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.ActivityRecognition
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionRequest
import com.google.android.gms.location.DetectedActivity
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread
import kotlin.math.roundToInt
import org.json.JSONArray
import org.json.JSONObject

class NativeMobilityService : Service(), SensorEventListener {
  private lateinit var fusedLocationClient: FusedLocationProviderClient
  private lateinit var sensorManager: SensorManager
  private var stepSensor: Sensor? = null
  private var uploadThread: Thread? = null
  private var running = false
  private var stepTracking = false
  private var recordingId = ""
  private var apiBaseUrl = ""
  private var accessToken = ""
  // The local calendar day the current recordingId was opened for. Continuous
  // tracking never gets an explicit "stop" from the user, so the service
  // itself has to notice a day boundary and roll the backend recording over,
  // the same way Google Maps buckets Timeline data by day.
  private var recordingDate = ""
  @Volatile private var stepCount = 0
  @Volatile private var syncedStepCount = 0
  private var lastStepSensorValue: Float? = null
  private var lastStepUploadScheduledAt = 0L
  private var lastLocationUploadScheduledAt = 0L
  private val queueLock = Any()

  private val activityPendingIntent by lazy {
    PendingIntent.getBroadcast(
      this,
      ACTIVITY_REQUEST_CODE,
      Intent(this, NativeMobilityActivityReceiver::class.java),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
  }

  // Tracks the last point we accepted into the trajectory so we can tell real
  // movement apart from GPS jitter, the same way Google Maps only advances
  // your location dot once a fix clears the combined error margin instead of
  // reacting to every noisy sample.
  private var lastAcceptedLocation: Location? = null
  private var lastAcceptedAt = 0L

  // Adaptive power: with the GPS chip pinned at PRIORITY_HIGH_ACCURACY every
  // 5s around the clock, location is by far the app's dominant battery cost
  // even though a phone typically sits still most of the day. Like Google
  // Timeline, downshift to balanced power (wifi/cell fixes, GPS idle) after a
  // few minutes without real movement, and upshift the moment movement is
  // detected again - via the (hardware-batched, near-free) step counter or a
  // coarse fix that clearly left the parked position.
  private var highPowerTracking = true
  private var lastMovementAt = 0L
  private var stepCountAtDownshift = 0

  private val locationCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      if (!running || recordingId.isBlank()) return
      try {
        if (!highPowerTracking) {
          // Low-power fixes are a wake-up signal ONLY - never recorded.
          // Indoor wifi/cell positioning jitters 40-100m while still
          // passing the 50m accuracy gate; recording those scribbled fake
          // movement all over genuine stays and fragmented the server's
          // visit detection. The per-fix distance gate is capped so even a
          // very coarse cell fix can still wake GPS on a real departure.
          val anchor = lastAcceptedLocation
          val moved = anchor != null && result.locations.any { fix ->
            anchor.distanceTo(fix) >=
              maxOf(UPSHIFT_DISTANCE_METERS, minOf(fix.accuracy, UPSHIFT_ACCURACY_GATE_CAP))
          }
          if (moved) {
            switchTrackingMode(highPower = true)
            return
          }
          // Keep dwell detection fed exactly like the high-power stationary
          // path does: an anchor-snapped heartbeat - without re-anchoring or
          // persisting the coarse fixes themselves.
          val heartbeatAnchor = lastAcceptedLocation ?: return
          val now = System.currentTimeMillis()
          if (now - lastAcceptedAt >= STATIONARY_HEARTBEAT_MS) {
            lastAcceptedAt = now
            recordPoints(listOf(Location(heartbeatAnchor).apply { time = now }))
          }
          return
        }
        val now = System.currentTimeMillis()
        val accepted = result.locations
          .filter { it.accuracy <= MAX_ACCURACY_METERS }
          .mapNotNull(::acceptedLocationOrNull)
        if (now - lastMovementAt >= STATIONARY_DOWNSHIFT_MS) {
          switchTrackingMode(highPower = false)
        }
        recordPoints(accepted)
      } catch (error: Throwable) {
        setLastError("保存后台定位点失败：\${error.message ?: error.javaClass.simpleName}")
      }
    }
  }

  // Shared by the subscription callback and the one-shot fix requested at
  // upshift: persist points locally, let the lazy sync interval decide when
  // they reach the server.
  private fun recordPoints(locations: List<Location>) {
    if (locations.isEmpty()) return
    val points = locations.map { it.toJsonPoint() }
    setLatestPoint(points.last().toString())
    appendPoints(points)
    val now = System.currentTimeMillis()
    if (now - lastLocationUploadScheduledAt >= LOCATION_UPLOAD_INTERVAL_MS) {
      lastLocationUploadScheduledAt = now
      scheduleUpload()
    }
  }

  /**
   * Decides whether a new fix represents real movement, and if so, what
   * location to actually record.
   *
   * Consumer GPS accuracy is rarely better than a few meters, so two fixes a
   * couple of meters apart while you are standing still are noise, not a
   * walk. We treat the sum of both fixes' reported accuracy radii as a noise
   * floor (bounded below by [MIN_DISTANCE_METERS]) and only accept the point
   * if it moved further than that. While stationary we still keep one
   * "heartbeat" point every [STATIONARY_HEARTBEAT_MS] so dwell-time / visit
   * detection still has data to work with - but that heartbeat must NOT
   * become the new reference point. Earlier this re-anchored to whatever
   * (possibly noisy) fix triggered the heartbeat, so on a long stay each
   * heartbeat's own GPS error compounded onto the last one, random-walking
   * the recorded position tens or hundreds of meters away from where the
   * phone actually sat - continuous 24/7 tracking gives this far more time
   * to accumulate than the old manual start/stop sessions did. The fix
   * keeps the anchor fixed to the last point that represented real movement
   * and snaps heartbeat emissions to that same anchor, so a genuine stay
   * reports as a single stable point instead of drifting.
   */
  private fun acceptedLocationOrNull(location: Location): Location? {
    val previous = lastAcceptedLocation
    if (previous == null) {
      lastAcceptedLocation = location
      lastAcceptedAt = location.time
      lastMovementAt = System.currentTimeMillis()
      return location
    }
    val distance = previous.distanceTo(location)
    val noiseFloor = maxOf(
      MIN_DISTANCE_METERS,
      minOf(previous.accuracy, ACCURACY_NOISE_CAP_METERS) +
        minOf(location.accuracy, ACCURACY_NOISE_CAP_METERS),
    )
    if (distance >= noiseFloor) {
      lastAcceptedLocation = location
      lastAcceptedAt = location.time
      lastMovementAt = System.currentTimeMillis()
      return location
    }
    if (location.time - lastAcceptedAt >= STATIONARY_HEARTBEAT_MS) {
      lastAcceptedAt = location.time
      return Location(previous).apply { time = location.time }
    }
    return null
  }

  override fun onCreate() {
    super.onCreate()
    try {
      fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
      sensorManager = getSystemService(SensorManager::class.java)
    } catch (error: Throwable) {
      failAndStop("初始化足迹服务失败", error)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    try {
      when (intent?.action) {
        ACTION_START -> {
          val nextRecordingId = intent.getStringExtra(EXTRA_RECORDING_ID).orEmpty()
          val persistedRecordingDate = restoreRecordingDate(nextRecordingId)
          restoreStepState(nextRecordingId)
          recordingId = nextRecordingId
          apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL).orEmpty().trimEnd('/')
          accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty()
          // A sticky-service recovery or device reboot can restart yesterday's
          // recording after midnight. Preserve the date stored with that ID so
          // scheduleUpload() rotates it instead of incorrectly relabelling the
          // stale recording as today's.
          recordingDate = persistedRecordingDate.ifBlank { currentLocalDateString() }
          persistConfig()
          startTracking()
        }
        ACTION_STOP -> stopTracking()
        ACTION_FLUSH -> {
          // On-demand sync (the app opening the map wants fresh data now
          // rather than at the next lazy 30-minute interval).
          if (running) {
            lastLocationUploadScheduledAt = System.currentTimeMillis()
            scheduleUpload()
          }
        }
        ACTION_UPDATE_AUTH -> {
          // Refreshes the upload credential of an already-running service
          // (the app pushes a fresh scoped token on launch); without this,
          // a service that never restarts would outlive any token.
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
          if (recordingId.isNotBlank()) startTracking() else stopSelf()
        }
      }
    } catch (error: Throwable) {
      failAndStop("启动足迹服务失败", error)
    }
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onDestroy() {
    try {
      stopLocationUpdates()
      stopStepTracking()
      stopActivityRecognition()
    } catch (_: Throwable) {
      // Destruction must never bring down the host process.
    }
    serviceRunning = false
    stepTrackingActive = false
    running = false
    super.onDestroy()
  }

  private fun startTracking() {
    if (recordingId.isBlank() || apiBaseUrl.isBlank() || accessToken.isBlank()) {
      setLastError("足迹服务缺少活动记录或登录信息。")
      stopSelf()
      return
    }
    startForegroundNotification()
    running = true
    lastAcceptedLocation = null
    lastAcceptedAt = 0L
    // Always (re)start in high-accuracy mode: the service may be starting
    // because the user just began moving (reboot, app relaunch mid-trip).
    highPowerTracking = true
    lastMovementAt = System.currentTimeMillis()
    requestLocationUpdates()
    startStepTracking()
    startActivityRecognition()
    setLastError("")
    serviceRunning = true
    scheduleUpload()
  }

  private fun startForegroundNotification() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(
        NOTIFICATION_ID,
        buildNotification(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
      )
    } else {
      startForeground(NOTIFICATION_ID, buildNotification())
    }
  }

  private fun stopTracking() {
    running = false
    serviceRunning = false
    stepTrackingActive = false
    stopLocationUpdates()
    stopStepTracking()
    stopActivityRecognition()
    scheduleUpload()
    clearConfig()
    clearActiveSnapshot()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  private fun requestLocationUpdates() {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      throw SecurityException("没有后台位置权限，无法持续记录足迹。")
    }
    if (
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) !=
        PackageManager.PERMISSION_GRANTED &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      throw SecurityException("没有前台位置权限，无法启动足迹服务。")
    }
    val request = if (highPowerTracking) {
      LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
        .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
        .setMinUpdateIntervalMillis(LOCATION_FASTEST_INTERVAL_MS)
        // Let the OS/hardware batch fixes and deliver them together instead
        // of waking the app for every single one - same fix rate and
        // accuracy, far fewer process wake-ups. Bounded to a minute (not
        // tied to the upload interval) so at most ~1 minute of fixes are
        // only in the OS's batch buffer - not yet in our own locally-
        // persisted queue - if the service were killed before delivery.
        .setMaxUpdateDelayMillis(LOCATION_BATCH_DELAY_MS)
        .setWaitForAccurateLocation(false)
        .build()
    } else {
      // Stationary: wifi/cell positioning only, GPS chip idle. These coarse
      // fixes exist to (a) notice we've left the parked spot and (b) keep
      // the stationary heartbeat fed for dwell detection.
      LocationRequest.Builder(
        Priority.PRIORITY_BALANCED_POWER_ACCURACY,
        LOW_POWER_INTERVAL_MS,
      )
        .setMinUpdateIntervalMillis(LOW_POWER_FASTEST_INTERVAL_MS)
        .setMaxUpdateDelayMillis(LOW_POWER_BATCH_DELAY_MS)
        .setWaitForAccurateLocation(false)
        .build()
    }
    fusedLocationClient.removeLocationUpdates(locationCallback)
    fusedLocationClient
      .requestLocationUpdates(request, locationCallback, Looper.getMainLooper())
      .addOnFailureListener { error ->
        setLastError("后台定位订阅失败：\${error.message ?: error.javaClass.simpleName}")
      }
  }

  private fun stopLocationUpdates() {
    if (::fusedLocationClient.isInitialized) {
      fusedLocationClient.removeLocationUpdates(locationCallback)
    }
    disarmSignificantMotionSensor()
  }

  private fun switchTrackingMode(highPower: Boolean) {
    if (highPowerTracking == highPower) return
    highPowerTracking = highPower
    if (highPower) {
      lastMovementAt = System.currentTimeMillis()
      disarmSignificantMotionSensor()
    } else {
      stepCountAtDownshift = stepCount
      armSignificantMotionSensor()
    }
    try {
      requestLocationUpdates()
    } catch (error: Throwable) {
      // Never let a mode switch kill tracking; fall back to the mode we were
      // in and try again on the next trigger.
      highPowerTracking = !highPower
      setLastError("切换定位功耗模式失败：\${error.message ?: error.javaClass.simpleName}")
      return
    }
    if (highPower) {
      // The subscription's first fix can take a full interval; losing those
      // seconds at departure is how track starts got clipped. Ask for one
      // fresh high-accuracy fix right now.
      requestImmediateFix()
    }
  }

  // Hardware significant-motion trigger: fires on walking OR vehicle motion
  // at effectively zero power, and is the primary departure signal while
  // parked - the step counter misses driving entirely, and coarse fixes can
  // take minutes to show clear displacement. One-shot by contract, so it is
  // re-armed on every downshift.
  private val significantMotionListener = object : TriggerEventListener() {
    override fun onTrigger(event: TriggerEvent?) {
      if (running && !highPowerTracking) {
        switchTrackingMode(highPower = true)
      }
    }
  }

  private fun armSignificantMotionSensor() {
    if (!::sensorManager.isInitialized) return
    val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) ?: return
    try {
      sensorManager.requestTriggerSensor(significantMotionListener, sensor)
    } catch (_: Throwable) {
      // Device quirk - the coarse-fix and step-count wake-ups still apply.
    }
  }

  private fun disarmSignificantMotionSensor() {
    if (!::sensorManager.isInitialized) return
    val sensor = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION) ?: return
    try {
      sensorManager.cancelTriggerSensor(significantMotionListener, sensor)
    } catch (_: Throwable) {
      // Already fired (one-shot) or never armed; nothing to cancel.
    }
  }

  private fun requestImmediateFix() {
    try {
      fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, null)
        .addOnSuccessListener { fix ->
          if (!running || !highPowerTracking || fix == null) {
            return@addOnSuccessListener
          }
          if (fix.accuracy > MAX_ACCURACY_METERS) {
            return@addOnSuccessListener
          }
          acceptedLocationOrNull(fix)?.let { recordPoints(listOf(it)) }
        }
    } catch (_: Throwable) {
      // The regular subscription delivers within seconds anyway.
    }
  }

  override fun onSensorChanged(event: SensorEvent) {
    if (!running || event.values.isEmpty()) return
    try {
      when (event.sensor.type) {
        Sensor.TYPE_STEP_COUNTER -> {
          val currentValue = event.values[0]
          val previousValue = lastStepSensorValue
          lastStepSensorValue = currentValue
          if (previousValue != null && currentValue >= previousValue) {
            stepCount += (currentValue - previousValue).roundToInt().coerceAtLeast(0)
          }
        }
        Sensor.TYPE_STEP_DETECTOR -> {
          stepCount += event.values[0].roundToInt().coerceAtLeast(1)
        }
      }
      persistStepState()
      // Walking is the cheapest possible movement signal (the step sensor is
      // hardware-batched); a burst of steps while parked in low-power mode
      // means we're moving again and GPS should wake up - including indoor
      // walks the coarse wifi fixes would miss entirely.
      if (
        !highPowerTracking &&
        stepCount - stepCountAtDownshift >= UPSHIFT_STEP_THRESHOLD
      ) {
        switchTrackingMode(highPower = true)
      }
      val now = System.currentTimeMillis()
      if (
        stepCount > syncedStepCount &&
        (
          stepCount - syncedStepCount >= STEP_UPLOAD_COUNT_INTERVAL ||
            now - lastStepUploadScheduledAt >= STEP_UPLOAD_TIME_INTERVAL_MS
        )
      ) {
        lastStepUploadScheduledAt = now
        scheduleUpload()
      }
    } catch (error: Throwable) {
      setLastError("记录步数失败：\${error.message ?: error.javaClass.simpleName}")
    }
  }

  override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

  private fun startStepTracking() {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      stepTracking = false
      stepTrackingActive = false
      return
    }
    if (!::sensorManager.isInitialized) return
    // Idempotent: continuous tracking can re-enter startTracking() (e.g. a
    // day-boundary recording rollover) while a listener is already
    // registered, and registering twice would double-count every step.
    sensorManager.unregisterListener(this)
    stepSensor =
      sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER)
        ?: sensorManager.getDefaultSensor(Sensor.TYPE_STEP_DETECTOR)
    stepTracking =
      stepSensor?.let {
        sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_NORMAL)
      } ?: false
    stepTrackingActive = stepTracking
  }

  private fun stopStepTracking() {
    if (::sensorManager.isInitialized) {
      sensorManager.unregisterListener(this)
    }
    stepSensor = null
    stepTracking = false
    stepTrackingActive = false
  }

  private fun startActivityRecognition() {
    if (
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
      ContextCompat.checkSelfPermission(this, Manifest.permission.ACTIVITY_RECOGNITION) !=
        PackageManager.PERMISSION_GRANTED
    ) {
      return
    }
    val transitions = listOf(
      DetectedActivity.WALKING,
      DetectedActivity.RUNNING,
      DetectedActivity.ON_BICYCLE,
      DetectedActivity.IN_VEHICLE,
      DetectedActivity.STILL,
    ).flatMap { activityType ->
      listOf(
        ActivityTransition.Builder()
          .setActivityType(activityType)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_ENTER)
          .build(),
        ActivityTransition.Builder()
          .setActivityType(activityType)
          .setActivityTransition(ActivityTransition.ACTIVITY_TRANSITION_EXIT)
          .build(),
      )
    }
    try {
      ActivityRecognition.getClient(this)
        .requestActivityTransitionUpdates(
          ActivityTransitionRequest(transitions),
          activityPendingIntent,
        )
        .addOnFailureListener { error ->
          setLastError("活动识别订阅失败：\${error.message ?: error.javaClass.simpleName}")
        }
    } catch (error: Throwable) {
      // Location and speed-based fallback remain active on devices without
      // Google Play services or without Activity Recognition support.
      setLastError("活动识别不可用，已使用速度判断：\${error.message ?: error.javaClass.simpleName}")
    }
  }

  private fun stopActivityRecognition() {
    try {
      ActivityRecognition.getClient(this)
        .removeActivityTransitionUpdates(activityPendingIntent)
    } catch (_: Throwable) {
      // Registration is optional; location tracking must still stop cleanly.
    }
  }

  private fun failAndStop(prefix: String, error: Throwable) {
    running = false
    serviceRunning = false
    stepTrackingActive = false
    setLastError("\${prefix}：\${error.message ?: error.javaClass.simpleName}")
    try {
      stopSelf()
    } catch (_: Throwable) {
      // The original failure is retained for the JS diagnostics.
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
      .setContentTitle("Daily Todo 正在记录足迹")
      .setContentText("正在持续记录行走路线，点位会先保存到本地并定时上传。")
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
        "Daily Todo 足迹记录",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "持续记录足迹时显示的通知"
      },
    )
  }

  private fun Location.toJsonPoint(): JSONObject {
    val recordedAt = ISO_FORMAT.get().format(Date(time))
    return JSONObject()
      .put("clientId", "\${time}:\${String.format(Locale.US, "%.6f", latitude)}:\${String.format(Locale.US, "%.6f", longitude)}")
      .put("recordedAt", recordedAt)
      .put("latitude", latitude)
      .put("longitude", longitude)
      .put("accuracy", if (hasAccuracy()) accuracy.toDouble() else JSONObject.NULL)
      .put("altitude", if (hasAltitude()) altitude else JSONObject.NULL)
      .put("speed", if (hasSpeed()) speed.toDouble() else JSONObject.NULL)
      .put("heading", if (hasBearing()) bearing.toDouble() else JSONObject.NULL)
      .put("activityType", NativeMobilityActivityReceiver.currentActivity(this@NativeMobilityService))
      .put("placeName", "")
  }

  private fun appendPoints(points: List<JSONObject>) {
    synchronized(queueLock) {
      val queue = readQueue()
      val batch = JSONObject()
        .put("recordingId", recordingId)
        .put("points", JSONArray(points))
      queue.put(batch)
      writeQueue(trimQueue(mergeQueue(queue)))
    }
  }

  private fun scheduleUpload() {
    if (uploadThread?.isAlive == true) return
    uploadThread = thread(name = "NativeMobilityUpload") {
      rotateRecordingIfDayChanged()
      flushQueue()
    }
  }

  private fun flushQueue() {
    if (apiBaseUrl.isBlank() || accessToken.isBlank()) return
    synchronized(queueLock) {
      val queue = mergeQueue(readQueue())
      if (queue.length() == 0) return@synchronized
      val remaining = JSONArray()
      for (batchIndex in 0 until queue.length()) {
        val batch = queue.getJSONObject(batchIndex)
        val batchRecordingId = batch.optString("recordingId")
        val points = batch.optJSONArray("points") ?: JSONArray()
        var offset = 0
        var batchFailed = false
        while (offset < points.length()) {
          val chunk = JSONArray()
          val end = minOf(offset + MAX_UPLOAD_POINTS, points.length())
          for (i in offset until end) {
            chunk.put(points.getJSONObject(i))
          }
          val status = uploadPoints(batchRecordingId, chunk)
          if (status in 200..299 || status == 404) {
            offset = end
            continue
          }
          if (status == 401) {
            // Surfaced through getLastError() so the app's diagnostics can
            // show it; points stay queued and flush once a fresh token
            // arrives with the next service start.
            setLastError("足迹上传凭证已过期，请打开应用一次以刷新授权。")
          }
          val pending = JSONArray()
          for (i in offset until points.length()) {
            pending.put(points.getJSONObject(i))
          }
          remaining.put(JSONObject().put("recordingId", batchRecordingId).put("points", pending))
          batchFailed = true
          break
        }
        if (batchFailed) {
          for (restIndex in batchIndex + 1 until queue.length()) {
            remaining.put(queue.getJSONObject(restIndex))
          }
          break
        }
      }
      writeQueue(trimQueue(mergeQueue(remaining)))
    }
    uploadSteps()
  }

  private fun uploadPoints(targetRecordingId: String, points: JSONArray): Int {
    if (targetRecordingId.isBlank() || points.length() == 0) return 204
    return try {
      val url = URL("\${apiBaseUrl}/mobility/recordings/\${targetRecordingId}/points")
      val body = JSONObject().put("points", points).toString()
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
      if (status in 200..299) {
        connection.inputStream?.close()
      } else {
        connection.errorStream?.close()
      }
      connection.disconnect()
      status
    } catch (_: Throwable) {
      -1
    }
  }

  private fun uploadSteps() {
    val targetRecordingId = recordingId
    val countToUpload = stepCount
    if (
      targetRecordingId.isBlank() ||
      countToUpload <= syncedStepCount ||
      apiBaseUrl.isBlank() ||
      accessToken.isBlank()
    ) {
      return
    }
    val status = try {
      val url = URL("\${apiBaseUrl}/mobility/recordings/\${targetRecordingId}/steps")
      val body = JSONObject()
        .put("sourceId", "native-step-\${targetRecordingId}")
        .put("stepCount", countToUpload)
        .put("recordedAt", ISO_FORMAT.get().format(Date()))
        .toString()
      val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "PUT"
        connectTimeout = NETWORK_TIMEOUT_MS
        readTimeout = NETWORK_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer \${accessToken}")
        setRequestProperty("Content-Type", "application/json")
      }
      connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
      val responseStatus = connection.responseCode
      if (responseStatus in 200..299) {
        connection.inputStream?.close()
      } else {
        connection.errorStream?.close()
      }
      connection.disconnect()
      responseStatus
    } catch (_: Throwable) {
      -1
    }
    if (status in 200..299 || status == 404) {
      syncedStepCount = maxOf(syncedStepCount, countToUpload)
      persistStepState()
    }
  }

  private fun currentLocalDateString(): String = LOCAL_DATE_FORMAT.get().format(Date())

  // Continuous tracking has no user-driven stop/start, so this is what turns
  // "one recording forever" into "one recording per day": whenever an upload
  // runs and the wall-clock day no longer matches the day the current
  // recording was opened for, close it out on the backend and open a fresh
  // one before flushing anything. Runs on the background upload thread only.
  private fun rotateRecordingIfDayChanged() {
    val today = currentLocalDateString()
    if (recordingId.isBlank() || apiBaseUrl.isBlank() || accessToken.isBlank()) return
    if (recordingDate.isNotBlank() && recordingDate == today) return
    val staleRecordingId = recordingId
    // Commit any final counter value before closing yesterday. Previously the
    // reset below could discard steps collected since the last upload.
    uploadSteps()
    if (!stopRecordingOnServer(staleRecordingId)) return
    val newRecordingId = startRecordingOnServer() ?: return
    if (newRecordingId == staleRecordingId) return
    restoreStepState(newRecordingId)
    recordingId = newRecordingId
    recordingDate = today
    persistConfig()
  }

  private fun stopRecordingOnServer(targetRecordingId: String): Boolean {
    if (targetRecordingId.isBlank()) return false
    return try {
      val url = URL("\${apiBaseUrl}/mobility/recordings/\${targetRecordingId}/stop")
      val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = NETWORK_TIMEOUT_MS
        readTimeout = NETWORK_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer \${accessToken}")
        setRequestProperty("Content-Type", "application/json")
      }
      connection.outputStream.use { it.write(ByteArray(0)) }
      val status = connection.responseCode
      if (status in 200..299) connection.inputStream?.close() else connection.errorStream?.close()
      connection.disconnect()
      status in 200..299 || status == 404
    } catch (_: Throwable) {
      false
    }
  }

  private fun startRecordingOnServer(): String? {
    return try {
      val url = URL("\${apiBaseUrl}/mobility/recordings/start")
      val connection = (url.openConnection() as HttpURLConnection).apply {
        requestMethod = "POST"
        connectTimeout = NETWORK_TIMEOUT_MS
        readTimeout = NETWORK_TIMEOUT_MS
        doOutput = true
        setRequestProperty("Authorization", "Bearer \${accessToken}")
        setRequestProperty("Content-Type", "application/json")
      }
      connection.outputStream.use { it.write(ByteArray(0)) }
      val status = connection.responseCode
      val body = (if (status in 200..299) connection.inputStream else connection.errorStream)
        ?.bufferedReader()?.use { it.readText() }
      connection.disconnect()
      if (status in 200..299 && body != null) {
        JSONObject(body).optString("id").ifBlank { null }
      } else {
        null
      }
    } catch (_: Throwable) {
      null
    }
  }

  private fun readQueue(): JSONArray {
    return try {
      JSONArray(queueFile().readText())
    } catch (_: Throwable) {
      JSONArray()
    }
  }

  private fun writeQueue(queue: JSONArray) {
    queueFile().writeText(queue.toString())
    queuedPointCount = countPoints(queue)
  }

  private fun mergeQueue(queue: JSONArray): JSONArray {
    val merged = linkedMapOf<String, LinkedHashMap<String, JSONObject>>()
    for (batchIndex in 0 until queue.length()) {
      val batch = queue.optJSONObject(batchIndex) ?: continue
      val batchRecordingId = batch.optString("recordingId")
      if (batchRecordingId.isBlank()) continue
      val points = batch.optJSONArray("points") ?: continue
      val target = merged.getOrPut(batchRecordingId) { linkedMapOf() }
      for (pointIndex in 0 until points.length()) {
        val point = points.optJSONObject(pointIndex) ?: continue
        val clientId = point.optString("clientId").ifBlank { randomClientId() }
        target[clientId] = point.put("clientId", clientId)
      }
    }
    val result = JSONArray()
    merged.forEach { (batchRecordingId, points) ->
      result.put(JSONObject().put("recordingId", batchRecordingId).put("points", JSONArray(points.values)))
    }
    return result
  }

  private fun trimQueue(queue: JSONArray): JSONArray {
    val batches = mutableListOf<Pair<String, MutableList<JSONObject>>>()
    for (batchIndex in 0 until queue.length()) {
      val batch = queue.optJSONObject(batchIndex) ?: continue
      val points = mutableListOf<JSONObject>()
      val batchPoints = batch.optJSONArray("points") ?: JSONArray()
      for (pointIndex in 0 until batchPoints.length()) {
        batchPoints.optJSONObject(pointIndex)?.let(points::add)
      }
      batches.add(batch.optString("recordingId") to points)
    }

    var remaining = MAX_QUEUED_POINTS
    val trimmed = ArrayDeque<Pair<String, List<JSONObject>>>()
    for ((batchRecordingId, points) in batches.asReversed()) {
      if (remaining <= 0) break
      val kept = points.takeLast(remaining)
      if (kept.isNotEmpty()) {
        trimmed.addFirst(batchRecordingId to kept)
        remaining -= kept.size
      }
    }
    val result = JSONArray()
    trimmed.forEach { (batchRecordingId, points) ->
      result.put(JSONObject().put("recordingId", batchRecordingId).put("points", JSONArray(points)))
    }
    return result
  }

  private fun countPoints(queue: JSONArray): Int {
    var count = 0
    for (batchIndex in 0 until queue.length()) {
      count += queue.optJSONObject(batchIndex)?.optJSONArray("points")?.length() ?: 0
    }
    return count
  }

  private fun queueFile(): File {
    val expoDirectory = File(filesDir, "ExperienceData/${PACKAGE_NAME}")
    expoDirectory.mkdirs()
    return File(expoDirectory, QUEUE_FILE_NAME)
  }

  private fun persistConfig() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putString("recordingId", recordingId)
      .putString("apiBaseUrl", apiBaseUrl)
      .putString("accessToken", accessToken)
      .putString("recordingDate", recordingDate)
      .putInt("stepCount", stepCount)
      .putInt("syncedStepCount", syncedStepCount)
      .putFloat("lastStepSensorValue", lastStepSensorValue ?: -1f)
      .apply()
  }

  private fun restoreConfig() {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    recordingId = prefs.getString("recordingId", "").orEmpty()
    apiBaseUrl = prefs.getString("apiBaseUrl", "").orEmpty()
    accessToken = prefs.getString("accessToken", "").orEmpty()
    recordingDate = prefs.getString("recordingDate", "").orEmpty()
    if (recordingDate.isBlank() && recordingId.isNotBlank()) {
      // Upgrading from a build that predates day-rotation: assume the
      // existing recording started today rather than forcing an immediate,
      // unnecessary rollover the first time this runs.
      recordingDate = currentLocalDateString()
    }
    stepCount = prefs.getInt("stepCount", 0)
    syncedStepCount = prefs.getInt("syncedStepCount", 0)
    lastStepSensorValue =
      prefs.getFloat("lastStepSensorValue", -1f).takeIf { it >= 0f }
  }

  private fun restoreStepState(nextRecordingId: String) {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    if (prefs.getString("recordingId", "").orEmpty() == nextRecordingId) {
      stepCount = prefs.getInt("stepCount", 0)
      syncedStepCount = prefs.getInt("syncedStepCount", 0)
      lastStepSensorValue =
        prefs.getFloat("lastStepSensorValue", -1f).takeIf { it >= 0f }
    } else {
      stepCount = 0
      syncedStepCount = 0
      lastStepSensorValue = null
    }
  }

  private fun restoreRecordingDate(nextRecordingId: String): String {
    val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return if (prefs.getString("recordingId", "").orEmpty() == nextRecordingId) {
      prefs.getString("recordingDate", "").orEmpty()
    } else {
      ""
    }
  }

  private fun persistStepState() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
      .putInt("stepCount", stepCount)
      .putInt("syncedStepCount", syncedStepCount)
      .putFloat("lastStepSensorValue", lastStepSensorValue ?: -1f)
      .apply()
  }

  private fun clearConfig() {
    getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().clear().apply()
  }

  private fun randomClientId(): String = "native-\${System.currentTimeMillis()}-\${random.nextInt(1_000_000)}"

  companion object {
    const val ACTION_START = "${PACKAGE_NAME}.mobility.START"
    const val ACTION_STOP = "${PACKAGE_NAME}.mobility.STOP"
    const val ACTION_UPDATE_AUTH = "${PACKAGE_NAME}.mobility.UPDATE_AUTH"
    const val ACTION_FLUSH = "${PACKAGE_NAME}.mobility.FLUSH"
    const val EXTRA_RECORDING_ID = "recordingId"
    const val EXTRA_API_BASE_URL = "apiBaseUrl"
    const val EXTRA_ACCESS_TOKEN = "accessToken"
    private const val CHANNEL_ID = "daily_todo_mobility"
    private const val NOTIFICATION_ID = 4307
    private const val ACTIVITY_REQUEST_CODE = 4308
    // Sampling cadence and noise filtering are tuned to behave like Google
    // Maps' location history: sample every few seconds instead of every
    // second, require a displacement bigger than typical GPS jitter before
    // treating it as movement, and reject wildly inaccurate fixes outright.
    private const val LOCATION_INTERVAL_MS = 5_000L
    private const val LOCATION_FASTEST_INTERVAL_MS = 3_000L
    private const val LOCATION_BATCH_DELAY_MS = 60_000L
    // Local-first: appendPoints() already durably queues every accepted fix
    // to SharedPreferences the moment it is delivered, independent of this.
    // The queue holds 250k points (weeks of data), so syncing every 30min
    // loses nothing; app launch, day rotation, and stop all force a flush.
    private const val LOCATION_UPLOAD_INTERVAL_MS = 1_800_000L
    // Adaptive power thresholds. Downshift after 3 minutes without a fix
    // that cleared the movement noise floor; upshift on ~15 steps (a real
    // walk, not a stretch at the desk) or a coarse fix that clearly left
    // the parked position.
    private const val STATIONARY_DOWNSHIFT_MS = 180_000L
    private const val LOW_POWER_INTERVAL_MS = 60_000L
    private const val LOW_POWER_FASTEST_INTERVAL_MS = 30_000L
    // No batching in low-power mode: these one-per-minute fixes are the
    // departure detector, and letting the OS hold them for two extra
    // minutes meant driving away went unnoticed for kilometers.
    private const val LOW_POWER_BATCH_DELAY_MS = 0L
    private const val UPSHIFT_STEP_THRESHOLD = 15
    private const val UPSHIFT_DISTANCE_METERS = 80f
    // A very coarse cell fix (accuracy 1-2km) must not need its own full
    // radius of displacement before waking GPS; cap what a single fix's
    // accuracy can demand of the departure check.
    private const val UPSHIFT_ACCURACY_GATE_CAP = 300f
    private const val MIN_DISTANCE_METERS = 8f
    // Fixes past ~50m of reported error are wifi/cell positions, not GPS -
    // in urban canyons they scatter hundreds of meters and are what drew
    // the jagged false detours on recorded routes. Dropping them loses
    // nothing: the stationary heartbeat keeps dwell detection fed, and a
    // real GPS fix follows within seconds outdoors.
    private const val MAX_ACCURACY_METERS = 50f
    // Movement floor cap per fix, mirroring the server's thinning: with raw
    // radii, two honest-but-coarse ~40m fixes demanded 80m of travel before
    // a point counted as movement, which dropped most fixes of a real walk
    // and left the recorded route sparse and corner-cutting.
    private const val ACCURACY_NOISE_CAP_METERS = 20f
    private const val STATIONARY_HEARTBEAT_MS = 60_000L
    private const val MAX_UPLOAD_POINTS = 250
    private const val MAX_QUEUED_POINTS = 250_000
    // Effectively time-driven at the same cadence as location sync (steps
    // also piggyback on every location flush via flushQueue -> uploadSteps),
    // so walking never opens its own extra connections. The count threshold
    // only exists as a backstop against an unbounded unsynced counter.
    private const val STEP_UPLOAD_COUNT_INTERVAL = 2_000
    private const val STEP_UPLOAD_TIME_INTERVAL_MS = 1_800_000L
    private const val NETWORK_TIMEOUT_MS = 15_000
    private const val PREFS_NAME = "daily_todo_native_mobility"
    private const val QUEUE_FILE_NAME = "native-mobility-points.json"
    private val random = SecureRandom()
    @Volatile private var serviceRunning = false
    @Volatile private var stepTrackingActive = false
    @Volatile private var queuedPointCount = 0
    @Volatile private var lastError = ""
    @Volatile private var latestPoint = ""
    @Volatile private var currentRecordingId = ""
    private val ISO_FORMAT = ThreadLocal.withInitial {
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
    }
    // Deliberately uses the device's default timezone (unlike ISO_FORMAT) so
    // day rotation follows the user's local calendar day.
    private val LOCAL_DATE_FORMAT = ThreadLocal.withInitial {
      SimpleDateFormat("yyyy-MM-dd", Locale.US)
    }

    fun isRunning(): Boolean = serviceRunning

    fun isStepTrackingActive(): Boolean = stepTrackingActive

    fun getLastError(): String = lastError

    fun getLatestPoint(): String = latestPoint

    fun prepareForStart(recordingId: String) {
      if (currentRecordingId != recordingId) {
        latestPoint = ""
      }
      currentRecordingId = recordingId
      lastError = ""
    }

    private fun setLastError(message: String) {
      lastError = message
    }

    private fun setLatestPoint(point: String) {
      latestPoint = point
    }

    private fun clearActiveSnapshot() {
      currentRecordingId = ""
      latestPoint = ""
    }

    fun clearPersistedConfig(context: Context) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .apply()
      serviceRunning = false
      stepTrackingActive = false
      clearActiveSnapshot()
    }

    fun restartPersisted(context: Context): Boolean {
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val persistedRecordingId = prefs.getString("recordingId", "").orEmpty()
      val persistedApiBaseUrl = prefs.getString("apiBaseUrl", "").orEmpty()
      val persistedAccessToken = prefs.getString("accessToken", "").orEmpty()
      if (
        persistedRecordingId.isBlank() ||
        persistedApiBaseUrl.isBlank() ||
        persistedAccessToken.isBlank()
      ) {
        return false
      }
      prepareForStart(persistedRecordingId)
      ContextCompat.startForegroundService(
        context,
        Intent(context, NativeMobilityService::class.java).apply {
          action = ACTION_START
          putExtra(EXTRA_RECORDING_ID, persistedRecordingId)
          putExtra(EXTRA_API_BASE_URL, persistedApiBaseUrl)
          putExtra(EXTRA_ACCESS_TOKEN, persistedAccessToken)
        },
      )
      return true
    }

    fun getQueuedPointCount(context: Context): Int {
      return try {
        val file = File(
          File(context.filesDir, "ExperienceData/${PACKAGE_NAME}"),
          QUEUE_FILE_NAME,
        )
        val queue = JSONArray(file.readText())
        var count = 0
        for (batchIndex in 0 until queue.length()) {
          count += queue.optJSONObject(batchIndex)?.optJSONArray("points")?.length() ?: 0
        }
        queuedPointCount = count
        count
      } catch (_: Throwable) {
        queuedPointCount
      }
    }

    // Wipes the not-yet-uploaded points queue after the user clears their
    // history, so stale points from a just-deleted recording don't get
    // re-uploaded. Any points already in flight that do land on a deleted
    // recording simply hit a 404, which flushQueue already treats as done.
    fun clearLocalQueue(context: Context) {
      try {
        val file = File(
          File(context.filesDir, "ExperienceData/${PACKAGE_NAME}"),
          QUEUE_FILE_NAME,
        )
        file.writeText(JSONArray().toString())
      } catch (_: Throwable) {
        // Best effort - a stale queue self-heals via the 404 handling above.
      }
      queuedPointCount = 0
    }
  }
}
`;

const nativeMobilityBootReceiverSource = `package ${PACKAGE_NAME}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class NativeMobilityBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (
      intent.action != Intent.ACTION_BOOT_COMPLETED &&
      intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
    ) {
      return
    }
    try {
      NativeMobilityService.restartPersisted(context)
    } catch (_: Throwable) {
      // Android may temporarily reject a foreground-service restart. Opening
      // the app will retry through the normal runtime reconciliation path.
    }
  }
}
`;

const nativeMobilityActivityReceiverSource = `package ${PACKAGE_NAME}

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.google.android.gms.location.ActivityTransition
import com.google.android.gms.location.ActivityTransitionResult
import com.google.android.gms.location.DetectedActivity

class NativeMobilityActivityReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (!ActivityTransitionResult.hasResult(intent)) return
    val result = ActivityTransitionResult.extractResult(intent) ?: return
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    for (event in result.transitionEvents) {
      val activity = activityName(event.activityType)
      if (event.transitionType == ActivityTransition.ACTIVITY_TRANSITION_ENTER) {
        prefs.edit()
          .putString(KEY_CURRENT_ACTIVITY, activity)
          .putLong(KEY_ACTIVITY_CHANGED_AT, event.elapsedRealTimeNanos)
          .apply()
      } else if (prefs.getString(KEY_CURRENT_ACTIVITY, "") == activity) {
        prefs.edit()
          .remove(KEY_CURRENT_ACTIVITY)
          .putLong(KEY_ACTIVITY_CHANGED_AT, event.elapsedRealTimeNanos)
          .apply()
      }
    }
  }

  companion object {
    private const val PREFS_NAME = "daily_todo_mobility_activity"
    private const val KEY_CURRENT_ACTIVITY = "currentActivity"
    private const val KEY_ACTIVITY_CHANGED_AT = "activityChangedAt"

    fun currentActivity(context: Context): String =
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .getString(KEY_CURRENT_ACTIVITY, "")
        .orEmpty()

    private fun activityName(type: Int): String = when (type) {
      DetectedActivity.WALKING -> "WALKING"
      DetectedActivity.RUNNING -> "RUNNING"
      DetectedActivity.ON_BICYCLE -> "ON_BICYCLE"
      DetectedActivity.IN_VEHICLE -> "IN_VEHICLE"
      DetectedActivity.STILL -> "STILL"
      else -> ""
    }
  }
}
`;

module.exports = createRunOncePlugin(
  withNativeMobility,
  "daily-todo-native-mobility",
  "1.0.0",
);
