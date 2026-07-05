package com.dailytodosync.app.expenses

import android.accessibilityservice.AccessibilityService
import android.app.Notification
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.util.concurrent.Executors

object ExpenseCaptureHealth {
  private const val PREFERENCES = "expense_capture_health"
  private const val KEY_NOTIFICATION_CONNECTED = "notification_connected"
  private const val KEY_ACCESSIBILITY_CONNECTED = "accessibility_connected"
  private const val KEY_LAST_NOTIFICATION_EVENT = "last_notification_event"
  private const val KEY_LAST_ACCESSIBILITY_EVENT = "last_accessibility_event"

  fun setNotificationConnected(context: Context, connected: Boolean) {
    preferences(context).edit()
      .putBoolean(KEY_NOTIFICATION_CONNECTED, connected)
      .apply()
  }

  fun setAccessibilityConnected(context: Context, connected: Boolean) {
    preferences(context).edit()
      .putBoolean(KEY_ACCESSIBILITY_CONNECTED, connected)
      .apply()
  }

  fun recordNotificationEvent(context: Context, timestamp: Long) {
    preferences(context).edit()
      .putLong(KEY_LAST_NOTIFICATION_EVENT, timestamp)
      .apply()
  }

  fun recordAccessibilityEvent(context: Context, timestamp: Long) {
    preferences(context).edit()
      .putLong(KEY_LAST_ACCESSIBILITY_EVENT, timestamp)
      .apply()
  }

  fun notificationConnected(context: Context): Boolean {
    return preferences(context).getBoolean(KEY_NOTIFICATION_CONNECTED, false)
  }

  fun accessibilityConnected(context: Context): Boolean {
    return preferences(context).getBoolean(KEY_ACCESSIBILITY_CONNECTED, false)
  }

  fun lastNotificationEvent(context: Context): Long? {
    return preferences(context)
      .getLong(KEY_LAST_NOTIFICATION_EVENT, 0L)
      .takeIf { it > 0L }
  }

  fun lastAccessibilityEvent(context: Context): Long? {
    return preferences(context)
      .getLong(KEY_LAST_ACCESSIBILITY_EVENT, 0L)
      .takeIf { it > 0L }
  }

  private fun preferences(context: Context) =
    context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
}

object ExpenseNotificationText {
  fun extract(notification: Notification): String {
    val extras = notification.extras ?: return ""
    val parts = linkedSetOf<String>()
    listOf(
      Notification.EXTRA_TITLE,
      Notification.EXTRA_TEXT,
      Notification.EXTRA_BIG_TEXT,
      Notification.EXTRA_SUB_TEXT,
      Notification.EXTRA_SUMMARY_TEXT,
    ).forEach { key ->
      extras.getCharSequence(key)?.toString()?.trim()?.takeIf(String::isNotEmpty)?.let(parts::add)
    }
    extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
      ?.map(CharSequence::toString)
      ?.map(String::trim)
      ?.filter(String::isNotEmpty)
      ?.forEach(parts::add)
    return parts.joinToString("\n").take(4000)
  }

  fun fingerprint(text: String): String {
    val normalized = text
      .replace(Regex("\\d"), "#")
      .replace(Regex("\\s+"), " ")
      .trim()
      .take(600)
    return ExpenseRepository.sha256(normalized)
  }
}

object ExpenseDiagnosticGate {
  private val moneyPattern = Regex(
    "(?:[¥￥]\\s*[-+]?\\d{1,9}(?:,\\d{3})*(?:\\.\\d{1,2})?" +
      "|[-+]?\\d{1,9}(?:,\\d{3})*(?:\\.\\d{1,2})?\\s*元" +
      "|(?:RMB|CNY|人民币)\\s*[-+]?\\d{1,9}(?:,\\d{3})*(?:\\.\\d{1,2})?)",
    RegexOption.IGNORE_CASE,
  )
  private val transactionWords = listOf(
    "支付",
    "付款",
    "支出",
    "收入",
    "扣款",
    "到账",
    "入账",
    "退款",
    "收款",
    "转账",
    "交易",
    "消费",
    "还款",
    "充值",
    "提现",
    "成功",
    "完成",
  )

  fun couldContainTransaction(text: String): Boolean {
    return moneyPattern.containsMatchIn(text) &&
      transactionWords.any(text::contains)
  }
}

/**
 * Production parsers are added only after a package/signature/version/template
 * has passed the real-device fixture gate. An empty registry is intentional:
 * unvalidated data may be sampled with explicit consent, but cannot create a
 * transaction.
 */
object ExpenseParserRegistry {
  fun parseNotification(
    source: ExpenseSourceEntity,
    notificationKey: String,
    eventTime: Long,
    text: String,
  ): ParsedExpenseCandidate? {
    @Suppress("UNUSED_VARIABLE")
    val reservedForValidatedAdapters = listOf(source, notificationKey, eventTime, text)
    return null
  }

  fun parseAccessibility(
    source: ExpenseSourceEntity,
    eventTime: Long,
    snapshot: String,
  ): ParsedExpenseCandidate? {
    @Suppress("UNUSED_VARIABLE")
    val reservedForValidatedAdapters = listOf(source, eventTime, snapshot)
    return null
  }
}

class ExpenseNotificationListenerService : NotificationListenerService() {
  private val executor = Executors.newSingleThreadExecutor()

  override fun onListenerConnected() {
    super.onListenerConnected()
    ExpenseCaptureHealth.setNotificationConnected(this, true)
  }

  override fun onListenerDisconnected() {
    ExpenseCaptureHealth.setNotificationConnected(this, false)
    super.onListenerDisconnected()
  }

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val posted = sbn ?: return
    val packageName = posted.packageName ?: return
    val eventTime = posted.postTime.takeIf { it > 0L } ?: System.currentTimeMillis()
    executor.execute {
      val repository = ExpenseRepository(applicationContext)
      val source = repository.getSource(packageName)
      if (source?.enabled != true) return@execute

      ExpenseCaptureHealth.recordNotificationEvent(applicationContext, eventTime)
      val text = ExpenseNotificationText.extract(posted.notification)
      if (text.isBlank() || !ExpenseDiagnosticGate.couldContainTransaction(text)) {
        return@execute
      }

      val candidate = ExpenseParserRegistry.parseNotification(
        source = source,
        notificationKey = posted.key,
        eventTime = eventTime,
        text = text,
      )
      if (candidate != null) {
        repository.acceptParsedCandidate(candidate)?.let { accepted ->
          ExpenseCaptureFeedback.show(applicationContext, accepted)
        }
      } else {
        repository.recordUnknownTemplate(packageName, eventTime)
        if (source.diagnosticCaptureEnabled) {
          repository.addDiagnosticSample(
            sourcePackage = packageName,
            sourceKind = "notification",
            templateFingerprint = ExpenseNotificationText.fingerprint(text),
            excerpt = text,
          )
        }
      }
    }
  }

  override fun onDestroy() {
    ExpenseCaptureHealth.setNotificationConnected(this, false)
    executor.shutdown()
    super.onDestroy()
  }
}

class ExpenseAccessibilityService : AccessibilityService() {
  private val handler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
  @Volatile private var enabledSources: Map<String, ExpenseSourceEntity> = emptyMap()
  private var pendingSnapshot: Runnable? = null
  private var confirmationOverlay: ExpenseConfirmationOverlay? = null

  private val sourceRefreshReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      refreshEnabledSources()
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    ExpenseCaptureHealth.setAccessibilityConnected(this, true)
    confirmationOverlay = ExpenseConfirmationOverlay(this)
    registerSourceRefreshReceiver()
    refreshEnabledSources()
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    val packageName = event?.packageName?.toString() ?: return
    val source = enabledSources[packageName] ?: return
    val eventTime = event.eventTime.takeIf { it > 0L } ?: System.currentTimeMillis()
    ExpenseCaptureHealth.recordAccessibilityEvent(this, eventTime)

    pendingSnapshot?.let(handler::removeCallbacks)
    val snapshotTask = Runnable {
      val activeRoot = rootInActiveWindow ?: return@Runnable
      val snapshot = AccessibilitySnapshot.create(activeRoot)
      if (
        snapshot.text.isBlank() ||
        !ExpenseDiagnosticGate.couldContainTransaction(snapshot.text)
      ) {
        return@Runnable
      }
      executor.execute {
        val repository = ExpenseRepository(applicationContext)
        val currentSource = repository.getSource(packageName)
        if (currentSource?.enabled != true) return@execute
        val candidate = ExpenseParserRegistry.parseAccessibility(
          source = currentSource,
          eventTime = eventTime,
          snapshot = snapshot.text,
        )
        if (candidate != null) {
          repository.acceptParsedCandidate(candidate)?.let(::showCaptureFeedback)
        } else {
          repository.recordUnknownTemplate(packageName, eventTime)
          if (currentSource.diagnosticCaptureEnabled) {
            repository.addDiagnosticSample(
              sourcePackage = packageName,
              sourceKind = "accessibility",
              templateFingerprint = snapshot.fingerprint,
              excerpt = snapshot.text,
            )
          }
        }
      }
    }
    pendingSnapshot = snapshotTask
    handler.postDelayed(snapshotTask, SNAPSHOT_DEBOUNCE_MILLIS)
  }

  override fun onInterrupt() = Unit

  override fun onDestroy() {
    pendingSnapshot?.let(handler::removeCallbacks)
    runCatching { unregisterReceiver(sourceRefreshReceiver) }
    confirmationOverlay?.dismiss()
    confirmationOverlay = null
    ExpenseCaptureHealth.setAccessibilityConnected(this, false)
    executor.shutdown()
    super.onDestroy()
  }

  private fun refreshEnabledSources() {
    executor.execute {
      val sources = ExpenseRepository(applicationContext)
        .getEnabledSources()
        .associateBy(ExpenseSourceEntity::packageName)
      enabledSources = sources
      handler.post {
        val currentInfo = serviceInfo ?: return@post
        currentInfo.packageNames =
          if (sources.isEmpty()) arrayOf(packageName) else sources.keys.toTypedArray()
        serviceInfo = currentInfo
      }
    }
  }

  private fun registerSourceRefreshReceiver() {
    val filter = IntentFilter(ACTION_REFRESH_SOURCES)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(sourceRefreshReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(sourceRefreshReceiver, filter)
    }
  }

  private fun showCaptureFeedback(accepted: AcceptedExpenseCapture) {
    handler.post {
      val overlay = confirmationOverlay
      if (overlay == null) {
        ExpenseCaptureFeedback.show(applicationContext, accepted)
        return@post
      }
      val shown = runCatching {
        val transaction = accepted.transaction
        if (transaction != null) {
          overlay.showRecorded(
            amountMinor = transaction.amountMinor,
            category = transaction.category,
            onUndo = {
              executor.execute {
                runCatching {
                  ExpenseRepository(applicationContext)
                    .deleteTransaction(transaction.id)
                }
              }
            },
          )
        } else {
          overlay.showConfirmation(
            candidate = accepted.candidate,
            onConfirm = {
              executor.execute {
                runCatching {
                  ExpenseRepository(applicationContext).confirmCandidate(
                    accepted.candidate.id,
                    null,
                    null,
                  )
                }
              }
            },
            onReview = {
              ExpenseCaptureFeedback.show(applicationContext, accepted)
            },
            onIgnore = {
              executor.execute {
                runCatching {
                  ExpenseRepository(applicationContext)
                    .ignoreCandidate(accepted.candidate.id)
                }
              }
            },
          )
        }
      }.isSuccess
      if (!shown) {
        ExpenseCaptureFeedback.show(applicationContext, accepted)
      }
    }
  }

  companion object {
    const val ACTION_REFRESH_SOURCES =
      "com.dailytodosync.app.expenses.REFRESH_ACCESSIBILITY_SOURCES"
    private const val SNAPSHOT_DEBOUNCE_MILLIS = 500L
  }
}

data class AccessibilitySnapshot(
  val text: String,
  val fingerprint: String,
) {
  companion object {
    fun create(root: AccessibilityNodeInfo): AccessibilitySnapshot {
      val lines = ArrayList<String>()
      val queue = ArrayDeque<Pair<AccessibilityNodeInfo, Int>>()
      queue.add(root to 0)
      var visited = 0

      while (queue.isNotEmpty() && visited < MAX_NODES) {
        val (node, depth) = queue.removeFirst()
        visited += 1
        val text = node.text?.toString()?.trim()
          ?: node.contentDescription?.toString()?.trim()
        if (!text.isNullOrEmpty()) {
          val className = node.className?.toString()?.substringAfterLast('.') ?: "View"
          val resource = node.viewIdResourceName?.substringAfterLast('/') ?: "-"
          lines += "$depth|$className|$resource|${text.take(MAX_NODE_TEXT)}"
        }
        if (depth < MAX_DEPTH) {
          for (index in 0 until node.childCount) {
            node.getChild(index)?.let { child -> queue.add(child to depth + 1) }
          }
        }
      }

      val snapshot = lines.joinToString("\n").take(MAX_SNAPSHOT_TEXT)
      val normalized = snapshot
        .replace(Regex("\\d"), "#")
        .replace(Regex("\\s+"), " ")
        .take(1200)
      return AccessibilitySnapshot(
        text = snapshot,
        fingerprint = ExpenseRepository.sha256(normalized),
      )
    }

    private const val MAX_NODES = 400
    private const val MAX_DEPTH = 16
    private const val MAX_NODE_TEXT = 160
    private const val MAX_SNAPSHOT_TEXT = 8000
  }
}
