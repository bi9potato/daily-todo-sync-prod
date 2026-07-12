const fs = require("fs");
const path = require("path");

const {
  createRunOncePlugin,
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
} = require("@expo/config-plugins");

const PACKAGE_NAME = "com.dailytodosync.app";
const REMINDER_PACKAGE_IMPORT = `${PACKAGE_NAME}.reminders.ReminderSettingsPackage`;

function upsertImport(source, importLine) {
  if (source.includes(importLine)) {
    return source;
  }
  return source.replace(/^(package\s+[^\r\n]+\r?\n)/m, `$1\n${importLine}\n`);
}

function withReminderManifest(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const usesPermissions = (manifestConfig.modResults.manifest[
      "uses-permission"
    ] ??= []);
    for (const permissionName of [
      "android.permission.SCHEDULE_EXACT_ALARM",
      // The Samsung Reminders-style alert page: the alarm notification
      // carries a full-screen intent so the popup shows over the lockscreen.
      "android.permission.USE_FULL_SCREEN_INTENT",
      "android.permission.RECEIVE_BOOT_COMPLETED",
      "android.permission.WAKE_LOCK",
    ]) {
      if (
        !usesPermissions.some(
          (permission) => permission.$["android:name"] === permissionName,
        )
      ) {
        usesPermissions.push({ $: { "android:name": permissionName } });
      }
    }

    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) {
      throw new Error("Reminder plugin: no <application> in manifest.");
    }
    const activities = (application.activity ??= []);
    const alertActivityName = `${PACKAGE_NAME}.reminders.ReminderAlertActivity`;
    if (!activities.some((item) => item.$["android:name"] === alertActivityName)) {
      activities.push({
        $: {
          "android:name": alertActivityName,
          "android:exported": "false",
          "android:excludeFromRecents": "true",
          "android:launchMode": "singleInstance",
          "android:taskAffinity": "",
          "android:showWhenLocked": "true",
          "android:turnScreenOn": "true",
          "android:theme": "@android:style/Theme.Black.NoTitleBar.Fullscreen",
        },
      });
    }
    const receivers = (application.receiver ??= []);
    const receiverName = `${PACKAGE_NAME}.reminders.ReminderAlarmReceiver`;
    if (!receivers.some((item) => item.$["android:name"] === receiverName)) {
      receivers.push({
        $: { "android:name": receiverName, "android:exported": "true" },
        "intent-filter": [
          {
            action: [
              { $: { "android:name": "android.intent.action.BOOT_COMPLETED" } },
              { $: { "android:name": "android.intent.action.MY_PACKAGE_REPLACED" } },
            ],
          },
        ],
      });
    }
    const services = (application.service ??= []);
    const serviceName = `${PACKAGE_NAME}.reminders.ReminderActionService`;
    if (!services.some((item) => item.$["android:name"] === serviceName)) {
      services.push({
        $: { "android:name": serviceName, "android:exported": "false" },
      });
    }
    return manifestConfig;
  });
}

function withReminderMainApplication(config) {
  return withMainApplication(config, (mainApplicationConfig) => {
    if (mainApplicationConfig.modResults.language !== "kt") {
      throw new Error("Reminder settings expects MainApplication.kt.");
    }
    let source = mainApplicationConfig.modResults.contents;
    source = upsertImport(source, `import ${REMINDER_PACKAGE_IMPORT}`);
    const packageLine = "add(ReminderSettingsPackage())";
    if (!source.includes(packageLine)) {
      source = source.replace(
        /(PackageList\(this\)\.packages\.apply\s*\{\s*)/,
        `$1\n          ${packageLine}\n          `,
      );
    }
    if (!source.includes(packageLine)) {
      throw new Error("Could not register ReminderSettingsPackage.");
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

function withReminderFiles(config) {
  return withDangerousMod(config, [
    "android",
    async (modConfig) => {
      const moduleRoot = path.join(
        modConfig.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        "com",
        "dailytodosync",
        "app",
        "reminders",
      );
      writeFileIfChanged(
        path.join(moduleRoot, "ReminderSettingsModule.kt"),
        reminderSettingsModuleSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "ReminderSettingsPackage.kt"),
        reminderSettingsPackageSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "ReminderAlarms.kt"),
        reminderAlarmsSource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "ReminderAlertActivity.kt"),
        reminderAlertActivitySource,
      );
      writeFileIfChanged(
        path.join(moduleRoot, "ReminderActionService.kt"),
        reminderActionServiceSource,
      );
      return modConfig;
    },
  ]);
}

function withReminderSettings(config) {
  return withReminderFiles(
    withReminderMainApplication(withReminderManifest(config)),
  );
}

const reminderSettingsPackageSource = `package ${PACKAGE_NAME}.reminders

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class ReminderSettingsPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(ReminderSettingsModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;

const reminderSettingsModuleSource = `package ${PACKAGE_NAME}.reminders

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray

class ReminderSettingsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ReminderSettings"

  override fun getConstants(): Map<String, Any> = mapOf(
    "reminderChannelId" to REMINDER_CHANNEL_ID,
    "supportsAlarmPipeline" to true,
  )

  // The native alarm pipeline behind the Samsung Reminders-style popup:
  // exact alarm -> full-screen-intent notification -> ReminderAlertActivity.
  @ReactMethod
  fun scheduleReminderAlarm(id: String, title: String, atMillis: Double, promise: Promise) {
    try {
      ReminderAlarmScheduler.schedule(reactApplicationContext, id, title, atMillis.toLong())
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_alarm_schedule_failed", error)
    }
  }

  @ReactMethod
  fun cancelReminderAlarm(id: String, promise: Promise) {
    try {
      ReminderAlarmScheduler.cancel(reactApplicationContext, id)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_alarm_cancel_failed", error)
    }
  }

  @ReactMethod
  fun getScheduledReminderAlarmIds(promise: Promise) {
    try {
      val ids = WritableNativeArray()
      for (id in ReminderAlarmStore.all(reactApplicationContext).keys) {
        ids.pushString(id)
      }
      promise.resolve(ids)
    } catch (error: Throwable) {
      promise.reject("reminder_alarm_list_failed", error)
    }
  }

  @ReactMethod
  fun presentReminderNow(id: String, body: String, promise: Promise) {
    try {
      ReminderNotifications.show(reactApplicationContext, id, body)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_present_failed", error)
    }
  }

  @ReactMethod
  fun ensureReminderNotificationChannel(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val manager =
          reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val alarmSound =
          RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val audioAttributes = AudioAttributes.Builder()
          .setUsage(AudioAttributes.USAGE_ALARM)
          .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
          .build()
        val channel = NotificationChannel(
          REMINDER_CHANNEL_ID,
          "任务提醒",
          NotificationManager.IMPORTANCE_HIGH,
        ).apply {
          description = "到时间和到达地点的任务提醒"
          enableLights(true)
          enableVibration(true)
          vibrationPattern = longArrayOf(0, 250, 250, 250)
          lockscreenVisibility = Notification.VISIBILITY_PUBLIC
          setSound(alarmSound, audioAttributes)
        }
        manager.createNotificationChannel(channel)
      }
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_channel_setup_failed", error)
    }
  }

  @ReactMethod
  fun canScheduleExactAlarms(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.resolve(true)
        return
      }
      val manager = reactApplicationContext.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      promise.resolve(manager.canScheduleExactAlarms())
    } catch (error: Throwable) {
      promise.reject("exact_alarm_check_failed", error)
    }
  }

  @ReactMethod
  fun openExactAlarmSettings(promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        promise.resolve(null)
        return
      }
      val intent = Intent(
        Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
        Uri.parse("package:\${reactApplicationContext.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("exact_alarm_settings_failed", error)
    }
  }

  @ReactMethod
  fun openReminderNotificationSettings(promise: Promise) {
    try {
      val intent = Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName)
        .putExtra(Settings.EXTRA_CHANNEL_ID, REMINDER_CHANNEL_ID)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("reminder_notification_settings_failed", error)
    }
  }

  // A scheduled reminder is an exact alarm, which Android fires regardless of
  // Doze - but some OEM battery managers (and even stock "Deep sleeping
  // apps" standby buckets) still throttle a backgrounded app's own follow-up
  // work. Exempting from battery optimization is the one standard,
  // OEM-agnostic lever for that, same API the footprint feature already
  // requests for the exact same reason.
  @ReactMethod
  fun isBatteryOptimizationDisabled(promise: Promise) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
      promise.resolve(true)
      return
    }
    val powerManager = reactApplicationContext.getSystemService(PowerManager::class.java)
    promise.resolve(
      powerManager?.isIgnoringBatteryOptimizations(reactApplicationContext.packageName) == true,
    )
  }

  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    try {
      val settingsIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val fallbackIntent = Intent(
        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
        Uri.parse("package:\${reactApplicationContext.packageName}"),
      ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      val intent =
        if (settingsIntent.resolveActivity(reactApplicationContext.packageManager) != null) {
          settingsIntent
        } else {
          fallbackIntent
        }
      reactApplicationContext.startActivity(intent)
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("battery_optimization_settings_failed", error)
    }
  }

  companion object {
    private const val REMINDER_CHANNEL_ID = "task-reminders-v2"
  }
}
`;

// The Samsung Reminders-style alarm pipeline: exact alarms fire a broadcast
// receiver that posts a full-screen-intent notification (popup over the
// lockscreen with 完成/稍后 actions). Completion runs a Headless JS task so
// it goes through the app's offline mutation queue without opening the UI.
const reminderAlarmsSource = `package ${PACKAGE_NAME}.reminders

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import com.facebook.react.HeadlessJsTaskService

object ReminderAlarmStore {
  private const val PREFS = "daily_todo_reminder_alarms"

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  fun put(context: Context, id: String, title: String, atMillis: Long) {
    prefs(context).edit().putString(id, atMillis.toString() + "|" + title).apply()
  }

  fun remove(context: Context, id: String) {
    prefs(context).edit().remove(id).apply()
  }

  fun all(context: Context): Map<String, Pair<Long, String>> {
    val result = mutableMapOf<String, Pair<Long, String>>()
    for ((key, value) in prefs(context).all) {
      val raw = value as? String ?: continue
      val separator = raw.indexOf('|')
      if (separator <= 0) continue
      val at = raw.substring(0, separator).toLongOrNull() ?: continue
      result[key] = Pair(at, raw.substring(separator + 1))
    }
    return result
  }
}

object ReminderAlarmScheduler {
  const val ACTION_FIRE = "${PACKAGE_NAME}.REMINDER_FIRE"
  const val ACTION_COMPLETE = "${PACKAGE_NAME}.REMINDER_COMPLETE"
  const val ACTION_SNOOZE = "${PACKAGE_NAME}.REMINDER_SNOOZE"
  const val EXTRA_ID = "occurrenceId"
  const val EXTRA_TITLE = "title"
  const val SNOOZE_MILLIS = 10L * 60L * 1000L

  fun schedule(context: Context, id: String, title: String, atMillis: Long) {
    ReminderAlarmStore.put(context, id, title, atMillis)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pending = firePendingIntent(context, id, title)
    val canExact =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()
    if (canExact) {
      manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
    } else {
      manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, atMillis, pending)
    }
  }

  fun cancel(context: Context, id: String) {
    ReminderAlarmStore.remove(context, id)
    val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    manager.cancel(firePendingIntent(context, id, ""))
    ReminderNotifications.cancel(context, id)
  }

  fun broadcastIntent(context: Context, action: String, id: String, title: String): Intent =
    Intent(context, ReminderAlarmReceiver::class.java)
      .setAction(action)
      .setData(Uri.parse("daily-todo-reminder://" + Uri.encode(id)))
      .putExtra(EXTRA_ID, id)
      .putExtra(EXTRA_TITLE, title)

  private fun firePendingIntent(context: Context, id: String, title: String): PendingIntent =
    PendingIntent.getBroadcast(
      context,
      id.hashCode(),
      broadcastIntent(context, ACTION_FIRE, id, title),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}

object ReminderNotifications {
  private const val CHANNEL_ID = "task-reminders-v2"

  fun show(context: Context, id: String, body: String) {
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    val alertIntent = Intent(context, ReminderAlertActivity::class.java)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      .putExtra(ReminderAlarmScheduler.EXTRA_ID, id)
      .putExtra(ReminderAlarmScheduler.EXTRA_TITLE, body)
    val alertPending = PendingIntent.getActivity(
      context,
      id.hashCode(),
      alertIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val openIntent = Intent(Intent.ACTION_VIEW, Uri.parse("daily-todo://today"))
      .setPackage(context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    val openPending = PendingIntent.getActivity(
      context,
      ("open" + id).hashCode(),
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val completePending = PendingIntent.getBroadcast(
      context,
      ("complete" + id).hashCode(),
      ReminderAlarmScheduler.broadcastIntent(
        context, ReminderAlarmScheduler.ACTION_COMPLETE, id, body,
      ),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val snoozePending = PendingIntent.getBroadcast(
      context,
      ("snooze" + id).hashCode(),
      ReminderAlarmScheduler.broadcastIntent(
        context, ReminderAlarmScheduler.ACTION_SNOOZE, id, body,
      ),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("任务提醒")
      .setContentText(body)
      .setCategory(Notification.CATEGORY_ALARM)
      .setContentIntent(openPending)
      .setAutoCancel(true)
      .addAction(Notification.Action.Builder(null, "完成", completePending).build())
      .addAction(Notification.Action.Builder(null, "推迟 10 分钟", snoozePending).build())

    val canUseFullScreen =
      Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE ||
        manager.canUseFullScreenIntent()
    if (canUseFullScreen) {
      builder.setFullScreenIntent(alertPending, true)
    }
    manager.notify(id.hashCode(), builder.build())
  }

  fun cancel(context: Context, id: String) {
    val manager =
      context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.cancel(id.hashCode())
  }
}

class ReminderAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      ReminderAlarmScheduler.ACTION_FIRE -> {
        val id = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_ID) ?: return
        val title = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_TITLE) ?: ""
        ReminderAlarmStore.remove(context, id)
        ReminderNotifications.show(context, id, title)
      }
      ReminderAlarmScheduler.ACTION_SNOOZE -> {
        val id = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_ID) ?: return
        val title = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_TITLE) ?: ""
        ReminderNotifications.cancel(context, id)
        ReminderAlarmScheduler.schedule(
          context, id, title, System.currentTimeMillis() + ReminderAlarmScheduler.SNOOZE_MILLIS,
        )
      }
      ReminderAlarmScheduler.ACTION_COMPLETE -> {
        val id = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_ID) ?: return
        ReminderNotifications.cancel(context, id)
        val serviceIntent = Intent(context, ReminderActionService::class.java)
          .putExtra("action", "complete")
          .putExtra(ReminderAlarmScheduler.EXTRA_ID, id)
        context.startService(serviceIntent)
        HeadlessJsTaskService.acquireWakeLockNow(context)
      }
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
        // Exact alarms do not survive a reboot; re-register everything that
        // is still pending, and fire anything that came due while off.
        val now = System.currentTimeMillis()
        for ((id, entry) in ReminderAlarmStore.all(context)) {
          if (entry.first <= now) {
            ReminderAlarmStore.remove(context, id)
            ReminderNotifications.show(context, id, entry.second)
          } else {
            ReminderAlarmScheduler.schedule(context, id, entry.second, entry.first)
          }
        }
      }
    }
  }
}
`;

const reminderAlertActivitySource = `package ${PACKAGE_NAME}.reminders

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.TextView
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

// The Samsung Reminders-style alert page a firing reminder pops over the
// lockscreen (their "Strong" alert style): task title front and center,
// 稍后提醒 / 完成 as two large bottom actions. Layout is built in code so
// the config plugin does not have to manage XML resources.
class ReminderAlertActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val id = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_ID) ?: ""
    val title = intent.getStringExtra(ReminderAlarmScheduler.EXTRA_TITLE) ?: ""
    val density = resources.displayMetrics.density
    fun dp(value: Int): Int = (value * density).toInt()

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(Color.parseColor("#161B18"))
      setPadding(dp(28), dp(48), dp(28), dp(40))
    }

    root.addView(TextView(this).apply {
      text = "任务提醒"
      setTextColor(Color.parseColor("#96A099"))
      textSize = 16f
      gravity = Gravity.CENTER
    })

    root.addView(TextView(this).apply {
      text = SimpleDateFormat("HH:mm", Locale.getDefault()).format(Date())
      setTextColor(Color.parseColor("#F1F4F1"))
      textSize = 44f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(0, dp(6), 0, dp(18))
    })

    root.addView(TextView(this).apply {
      text = title
      setTextColor(Color.parseColor("#F1F4F1"))
      textSize = 24f
      typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      gravity = Gravity.CENTER
      setPadding(dp(8), 0, dp(8), dp(48))
    })

    fun pillButton(label: String, background: Int, textColor: Int, onTap: () -> Unit): TextView =
      TextView(this).apply {
        text = label
        setTextColor(textColor)
        textSize = 17f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
        setPadding(dp(20), dp(14), dp(20), dp(14))
        val shape = GradientDrawable()
        shape.cornerRadius = dp(28).toFloat()
        shape.setColor(background)
        this.background = shape
        setOnClickListener { onTap() }
      }

    val buttons = LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER
    }
    val snooze = pillButton(
      "稍后提醒", Color.parseColor("#2E3531"), Color.parseColor("#F1F4F1"),
    ) {
      sendBroadcast(
        ReminderAlarmScheduler.broadcastIntent(
          this, ReminderAlarmScheduler.ACTION_SNOOZE, id, title,
        ),
      )
      finish()
    }
    val complete = pillButton(
      "完成", Color.parseColor("#8FC3AA"), Color.parseColor("#10281C"),
    ) {
      sendBroadcast(
        ReminderAlarmScheduler.broadcastIntent(
          this, ReminderAlarmScheduler.ACTION_COMPLETE, id, title,
        ),
      )
      finish()
    }
    val buttonParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
    buttonParams.setMargins(dp(6), 0, dp(6), 0)
    buttons.addView(snooze, buttonParams)
    buttons.addView(complete, LinearLayout.LayoutParams(buttonParams))
    root.addView(
      buttons,
      LinearLayout.LayoutParams(
        LinearLayout.LayoutParams.MATCH_PARENT,
        LinearLayout.LayoutParams.WRAP_CONTENT,
      ),
    )

    setContentView(root)
  }
}
`;

const reminderActionServiceSource = `package ${PACKAGE_NAME}.reminders

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig

// Runs the JS side of a notification/popup action (completing the task via
// the app's offline mutation queue) without bringing the UI to the front.
class ReminderActionService : HeadlessJsTaskService() {
  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: return null
    return HeadlessJsTaskConfig(
      "DailyTodoReminderAction",
      Arguments.fromBundle(extras),
      30_000,
      true,
    )
  }
}
`;

module.exports = createRunOncePlugin(
  withReminderSettings,
  "daily-todo-reminder-settings",
  "2.0.0",
);
