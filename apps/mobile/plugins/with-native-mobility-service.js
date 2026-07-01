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
import android.os.Build
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
      NativeMobilityService.clearLastError()
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
  fun getQueuedPointCount(promise: Promise) {
    promise.resolve(NativeMobilityService.getQueuedPointCount(reactContext))
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
import android.location.Location
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
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
  @Volatile private var stepCount = 0
  @Volatile private var syncedStepCount = 0
  private var lastStepSensorValue: Float? = null
  private var lastStepUploadScheduledAt = 0L
  private val queueLock = Any()

  private val locationCallback = object : LocationCallback() {
    override fun onLocationResult(result: LocationResult) {
      if (!running || recordingId.isBlank()) return
      try {
        val points = result.locations
          .filter { it.accuracy <= MAX_ACCURACY_METERS }
          .map { it.toJsonPoint() }
        if (points.isEmpty()) return
        appendPoints(points)
        scheduleUpload()
      } catch (error: Throwable) {
        setLastError("保存后台定位点失败：\${error.message ?: error.javaClass.simpleName}")
      }
    }
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
          restoreStepState(nextRecordingId)
          recordingId = nextRecordingId
          apiBaseUrl = intent.getStringExtra(EXTRA_API_BASE_URL).orEmpty().trimEnd('/')
          accessToken = intent.getStringExtra(EXTRA_ACCESS_TOKEN).orEmpty()
          persistConfig()
          startTracking()
        }
        ACTION_STOP -> stopTracking()
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
    requestLocationUpdates()
    startStepTracking()
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
    val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
      .setMinUpdateDistanceMeters(MIN_DISTANCE_METERS)
      .setMinUpdateIntervalMillis(LOCATION_FASTEST_INTERVAL_MS)
      .setWaitForAccurateLocation(false)
      .build()
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
    const val EXTRA_RECORDING_ID = "recordingId"
    const val EXTRA_API_BASE_URL = "apiBaseUrl"
    const val EXTRA_ACCESS_TOKEN = "accessToken"
    private const val CHANNEL_ID = "daily_todo_mobility"
    private const val NOTIFICATION_ID = 4307
    private const val LOCATION_INTERVAL_MS = 10_000L
    private const val LOCATION_FASTEST_INTERVAL_MS = 5_000L
    private const val MIN_DISTANCE_METERS = 10f
    private const val MAX_ACCURACY_METERS = 500f
    private const val MAX_UPLOAD_POINTS = 250
    private const val MAX_QUEUED_POINTS = 10_000
    private const val STEP_UPLOAD_COUNT_INTERVAL = 10
    private const val STEP_UPLOAD_TIME_INTERVAL_MS = 15_000L
    private const val NETWORK_TIMEOUT_MS = 15_000
    private const val PREFS_NAME = "daily_todo_native_mobility"
    private const val QUEUE_FILE_NAME = "native-mobility-points.json"
    private val random = SecureRandom()
    @Volatile private var serviceRunning = false
    @Volatile private var stepTrackingActive = false
    @Volatile private var queuedPointCount = 0
    @Volatile private var lastError = ""
    private val ISO_FORMAT = ThreadLocal.withInitial {
      SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
      }
    }

    fun isRunning(): Boolean = serviceRunning

    fun isStepTrackingActive(): Boolean = stepTrackingActive

    fun getLastError(): String = lastError

    fun clearLastError() {
      lastError = ""
    }

    private fun setLastError(message: String) {
      lastError = message
    }

    fun clearPersistedConfig(context: Context) {
      context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        .edit()
        .clear()
        .apply()
      serviceRunning = false
      stepTrackingActive = false
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
  }
}
`;

module.exports = createRunOncePlugin(
  withNativeMobility,
  "daily-todo-native-mobility",
  "1.0.0",
);
