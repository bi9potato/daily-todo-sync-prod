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
    const permissionName = "android.permission.SCHEDULE_EXACT_ALARM";
    if (
      !usesPermissions.some(
        (permission) => permission.$["android:name"] === permissionName,
      )
    ) {
      usesPermissions.push({ $: { "android:name": permissionName } });
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
import android.provider.Settings
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class ReminderSettingsModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "ReminderSettings"

  override fun getConstants(): Map<String, Any> = mapOf(
    "reminderChannelId" to REMINDER_CHANNEL_ID,
  )

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

  companion object {
    private const val REMINDER_CHANNEL_ID = "task-reminders-v2"
  }
}
`;

module.exports = createRunOncePlugin(
  withReminderSettings,
  "daily-todo-reminder-settings",
  "1.1.0",
);
