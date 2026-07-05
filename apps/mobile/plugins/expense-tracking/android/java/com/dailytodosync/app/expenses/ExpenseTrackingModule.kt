package com.dailytodosync.app.expenses

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import java.security.MessageDigest
import java.util.concurrent.Executors

class ExpenseTrackingModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {
  private val executor = Executors.newSingleThreadExecutor()
  private val repository by lazy { ExpenseRepository(reactApplicationContext) }

  init {
    ExpenseDiagnosticCleanupWorker.schedule(reactContext)
  }

  override fun getName(): String = "ExpenseTracking"

  @ReactMethod
  fun getHealth(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_health_failed") {
        Arguments.createMap().apply {
          putBoolean("notificationAccessGranted", hasNotificationAccess())
          putBoolean("notificationListenerConnected", ExpenseCaptureHealth.notificationConnected(reactApplicationContext))
          putBoolean("accessibilityAccessGranted", hasAccessibilityAccess())
          putBoolean("accessibilityServiceConnected", ExpenseCaptureHealth.accessibilityConnected(reactApplicationContext))
          putBoolean(
            "appNotificationsEnabled",
            NotificationManagerCompat.from(reactApplicationContext).areNotificationsEnabled(),
          )
          val powerManager =
            reactApplicationContext.getSystemService(Context.POWER_SERVICE) as PowerManager
          putBoolean(
            "ignoringBatteryOptimizations",
            powerManager.isIgnoringBatteryOptimizations(reactApplicationContext.packageName),
          )
          putNullableDouble(
            "lastNotificationEventAt",
            ExpenseCaptureHealth.lastNotificationEvent(reactApplicationContext)?.toDouble(),
          )
          putNullableDouble(
            "lastAccessibilityEventAt",
            ExpenseCaptureHealth.lastAccessibilityEvent(reactApplicationContext)?.toDouble(),
          )
          putInt("androidSdk", Build.VERSION.SDK_INT)
          putString("androidRelease", Build.VERSION.RELEASE)
          putInt("enabledSourceCount", repository.getEnabledSources().size)
          putInt("pendingCandidateCount", repository.getPendingCandidates(500).size)
        }
      }
    }
  }

  @ReactMethod
  fun getTransactions(dayKey: String, promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_transactions_failed") {
        Arguments.createMap().apply {
          val transactions = Arguments.createArray()
          repository.getTransactionsForDay(dayKey).forEach { transaction ->
            transactions.pushMap(transaction.toWritableMap())
          }
          val summary = repository.getSummaryForDay(dayKey)
          putArray("transactions", transactions)
          putMap("summary", summary.toWritableMap())
        }
      }
    }
  }

  @ReactMethod
  fun getPendingCandidates(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_candidates_failed") {
        Arguments.createArray().apply {
          repository.getPendingCandidates().forEach { candidate ->
            pushMap(candidate.toWritableMap())
          }
        }
      }
    }
  }

  @ReactMethod
  fun addManualTransaction(
    amountMinor: Double,
    occurredAt: Double,
    moneyNature: String,
    category: String?,
    merchant: String?,
    promise: Promise,
  ) {
    executor.execute {
      resolveSafely(promise, "expense_manual_create_failed") {
        repository.addManualTransaction(
          amountMinor = amountMinor.toLong(),
          occurredAt = occurredAt.toLong(),
          moneyNature = moneyNature,
          category = category,
          merchant = merchant,
        ).toWritableMap()
      }
    }
  }

  @ReactMethod
  fun confirmCandidate(
    candidateId: String,
    moneyNature: String?,
    category: String?,
    promise: Promise,
  ) {
    executor.execute {
      resolveSafely(promise, "expense_candidate_confirm_failed") {
        repository.confirmCandidate(
          candidateId = candidateId,
          moneyNatureOverride = moneyNature,
          categoryOverride = category,
        ).toWritableMap()
      }
    }
  }

  @ReactMethod
  fun ignoreCandidate(candidateId: String, promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_candidate_ignore_failed") {
        repository.ignoreCandidate(candidateId)
        null
      }
    }
  }

  @ReactMethod
  fun deleteTransaction(transactionId: String, promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_transaction_delete_failed") {
        repository.deleteTransaction(transactionId)
        null
      }
    }
  }

  @ReactMethod
  fun getInstalledApps(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_installed_apps_failed") {
        val packageManager = reactApplicationContext.packageManager
        val launcherIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val activities = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          packageManager.queryIntentActivities(
            launcherIntent,
            PackageManager.ResolveInfoFlags.of(0L),
          )
        } else {
          @Suppress("DEPRECATION")
          packageManager.queryIntentActivities(launcherIntent, 0)
        }
        val seen = mutableSetOf<String>()
        val apps = activities
          .mapNotNull { it.activityInfo?.applicationInfo }
          .filter { seen.add(it.packageName) }
          .filter { it.packageName != reactApplicationContext.packageName }
          .sortedBy { application -> packageManager.getApplicationLabel(application).toString() }

        Arguments.createArray().apply {
          apps.forEach { application ->
            val packageInfo = getPackageInfo(application.packageName)
            pushMap(
              Arguments.createMap().apply {
                putString("packageName", application.packageName)
                putString(
                  "label",
                  packageManager.getApplicationLabel(application).toString(),
                )
                putString("versionName", packageInfo?.versionName)
                putDouble("versionCode", packageInfo?.longVersionCode?.toDouble() ?: 0.0)
                putString(
                  "signingCertSha256",
                  packageInfo?.let(::signingCertificateSha256),
                )
              },
            )
          }
        }
      }
    }
  }

  @ReactMethod
  fun getSources(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_sources_failed") {
        Arguments.createArray().apply {
          repository.getSources().forEach { source -> pushMap(source.toWritableMap()) }
        }
      }
    }
  }

  @ReactMethod
  fun setSourceConfig(
    packageName: String,
    enabled: Boolean,
    diagnosticCaptureEnabled: Boolean,
    promise: Promise,
  ) {
    executor.execute {
      resolveSafely(promise, "expense_source_update_failed") {
        val packageManager = reactApplicationContext.packageManager
        val packageInfo = requireNotNull(getPackageInfo(packageName)) {
          "The selected app is no longer installed."
        }
        val applicationInfo = packageInfo.applicationInfo
          ?: error("The selected app has no application information.")
        val source = repository.upsertSource(
          packageName = packageName,
          label = packageManager.getApplicationLabel(applicationInfo).toString(),
          versionName = packageInfo.versionName,
          versionCode = packageInfo.longVersionCode,
          signingCertSha256 = signingCertificateSha256(packageInfo),
          enabled = enabled,
          diagnosticCaptureEnabled = diagnosticCaptureEnabled,
        )
        reactApplicationContext.sendBroadcast(
          Intent(ExpenseAccessibilityService.ACTION_REFRESH_SOURCES)
            .setPackage(reactApplicationContext.packageName),
        )
        source.toWritableMap()
      }
    }
  }

  @ReactMethod
  fun getDiagnosticSamples(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_diagnostics_failed") {
        Arguments.createArray().apply {
          repository.getDiagnosticSamples().forEach { (sample, excerpt) ->
            pushMap(
              Arguments.createMap().apply {
                putString("id", sample.id)
                putString("sourcePackage", sample.sourcePackage)
                putString("sourceKind", sample.sourceKind)
                putDouble("capturedAt", sample.capturedAt.toDouble())
                putString("templateFingerprint", sample.templateFingerprint)
                putString("excerpt", excerpt)
              },
            )
          }
        }
      }
    }
  }

  @ReactMethod
  fun clearDiagnosticSamples(promise: Promise) {
    executor.execute {
      resolveSafely(promise, "expense_diagnostics_clear_failed") {
        repository.clearDiagnosticSamples()
        null
      }
    }
  }

  @ReactMethod
  fun openNotificationAccessSettings(promise: Promise) {
    openSettings(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS), promise)
  }

  @ReactMethod
  fun openAccessibilitySettings(promise: Promise) {
    openSettings(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS), promise)
  }

  @ReactMethod
  fun openAppNotificationSettings(promise: Promise) {
    openSettings(
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, reactApplicationContext.packageName),
      promise,
    )
  }

  @ReactMethod
  fun openBatteryOptimizationSettings(promise: Promise) {
    openSettings(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS), promise)
  }

  private fun openSettings(intent: Intent, promise: Promise) {
    try {
      reactApplicationContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      promise.resolve(null)
    } catch (error: Throwable) {
      promise.reject("expense_settings_open_failed", error)
    }
  }

  private fun hasNotificationAccess(): Boolean {
    return NotificationManagerCompat.getEnabledListenerPackages(reactApplicationContext)
      .contains(reactApplicationContext.packageName)
  }

  private fun hasAccessibilityAccess(): Boolean {
    val expected = ComponentName(
      reactApplicationContext,
      ExpenseAccessibilityService::class.java,
    )
    val enabled = Settings.Secure.getString(
      reactApplicationContext.contentResolver,
      Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
    ) ?: return false
    return enabled
      .split(':')
      .mapNotNull(ComponentName::unflattenFromString)
      .any { component ->
        component.packageName == expected.packageName &&
          component.className == expected.className
      }
  }

  private fun getPackageInfo(packageName: String): android.content.pm.PackageInfo? {
    val manager = reactApplicationContext.packageManager
    return runCatching {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        manager.getPackageInfo(
          packageName,
          PackageManager.PackageInfoFlags.of(PackageManager.GET_SIGNING_CERTIFICATES.toLong()),
        )
      } else {
        @Suppress("DEPRECATION")
        manager.getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
      }
    }.getOrNull()
  }

  private fun signingCertificateSha256(
    packageInfo: android.content.pm.PackageInfo,
  ): String? {
    val signatures = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val signingInfo = packageInfo.signingInfo ?: return null
      signingInfo.apkContentsSigners
    } else {
      @Suppress("DEPRECATION")
      packageInfo.signatures
    }
    val signature = signatures?.firstOrNull() ?: return null
    return MessageDigest.getInstance("SHA-256")
      .digest(signature.toByteArray())
      .joinToString("") { byte -> "%02x".format(byte) }
  }

  private fun <T> resolveSafely(
    promise: Promise,
    errorCode: String,
    block: () -> T,
  ) {
    try {
      promise.resolve(block())
    } catch (error: Throwable) {
      promise.reject(errorCode, error)
    }
  }
}

private fun ExpenseTransactionRecord.toWritableMap(): WritableMap {
  return Arguments.createMap().apply {
    putString("id", id)
    putDouble("occurredAt", occurredAt.toDouble())
    putDouble("detectedAt", detectedAt.toDouble())
    putDouble("amountMinor", amountMinor.toDouble())
    putString("currency", currency)
    putString("moneyNature", moneyNature)
    putString("category", category)
    putString("merchant", merchant)
    putString("account", account)
    putString("reviewState", reviewState)
    putString("confidenceLevel", confidenceLevel)
    putStringArray("confidenceReasons", confidenceReasons)
    putBoolean("excludedFromTotals", excludedFromTotals)
    putString("originalTransactionId", originalTransactionId)
    putString("sourceSummary", sourceSummary)
  }
}

private fun ExpenseCandidateRecord.toWritableMap(): WritableMap {
  return Arguments.createMap().apply {
    putString("id", id)
    putDouble("occurredAt", occurredAt.toDouble())
    putDouble("detectedAt", detectedAt.toDouble())
    putNullableDouble("amountMinor", amountMinor?.toDouble())
    putString("currency", currency)
    putString("moneyNature", moneyNature)
    putString("category", category)
    putString("merchant", merchant)
    putString("confidenceLevel", confidenceLevel)
    putStringArray("confidenceReasons", confidenceReasons)
    putString("sourcePackage", sourcePackage)
    putString("sourceKind", sourceKind)
  }
}

private fun ExpenseDaySummary.toWritableMap(): WritableMap {
  return Arguments.createMap().apply {
    putDouble("expenseMinor", expenseMinor.toDouble())
    putDouble("incomeMinor", incomeMinor.toDouble())
    putDouble("refundMinor", refundMinor.toDouble())
    putDouble("excludedMinor", excludedMinor.toDouble())
    putInt("transactionCount", transactionCount)
  }
}

private fun ExpenseSourceEntity.toWritableMap(): WritableMap {
  return Arguments.createMap().apply {
    putString("packageName", packageName)
    putString("label", label)
    putString("versionName", versionName)
    putDouble("versionCode", versionCode.toDouble())
    putString("signingCertSha256", signingCertSha256)
    putBoolean("enabled", enabled)
    putBoolean("diagnosticCaptureEnabled", diagnosticCaptureEnabled)
    putString("validationState", validationState)
    putString("validatedTemplateVersion", validatedTemplateVersion)
    putDouble("unknownTemplateCount", unknownTemplateCount.toDouble())
    putNullableDouble("lastEventAt", lastEventAt?.toDouble())
    putNullableDouble("lastParsedAt", lastParsedAt?.toDouble())
  }
}

private fun WritableMap.putStringArray(key: String, values: List<String>) {
  val array: WritableArray = Arguments.createArray()
  values.forEach(array::pushString)
  putArray(key, array)
}

private fun WritableMap.putNullableDouble(key: String, value: Double?) {
  if (value == null) {
    putNull(key)
  } else {
    putDouble(key, value)
  }
}
