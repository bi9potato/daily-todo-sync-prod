package com.dailytodosync.app.expenses

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.dailytodosync.app.MainActivity
import com.dailytodosync.app.R
import java.util.concurrent.Executors

object ExpenseCaptureFeedback {
  private const val CHANNEL_ID = "expense-review-v1"

  fun show(context: Context, accepted: AcceptedExpenseCapture) {
    ensureChannel(context)
    val candidate = accepted.candidate
    val amount = candidate.amountMinor?.let(::formatAmount) ?: "金额待确认"
    val automatic = accepted.transaction != null
    val title = if (automatic) "已自动记录 $amount" else "发现一笔待核对交易"
    val detail = listOfNotNull(candidate.merchant, candidate.category)
      .joinToString(" · ")
      .ifBlank { "${candidate.sourcePackage} · $amount" }
    val openIntent = Intent(
      Intent.ACTION_VIEW,
      Uri.parse("daily-todo:///expenses"),
      context,
      MainActivity::class.java,
    ).apply {
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      context,
      candidate.id.hashCode(),
      openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(R.drawable.expense_notification_icon)
      .setColor(Color.rgb(44, 87, 69))
      .setContentTitle(title)
      .setContentText(detail)
      .setStyle(NotificationCompat.BigTextStyle().bigText(detail))
      .setAutoCancel(true)
      .setContentIntent(pendingIntent)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setCategory(NotificationCompat.CATEGORY_REMINDER)
    accepted.transaction?.let { transaction ->
      val undoIntent = Intent(context, ExpenseUndoReceiver::class.java)
        .putExtra(ExpenseUndoReceiver.EXTRA_TRANSACTION_ID, transaction.id)
        .putExtra(ExpenseUndoReceiver.EXTRA_NOTIFICATION_ID, candidate.id.hashCode())
      val undoPendingIntent = PendingIntent.getBroadcast(
        context,
        transaction.id.hashCode(),
        undoIntent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      builder.addAction(
        R.drawable.expense_notification_icon,
        "撤销",
        undoPendingIntent,
      )
    }
    val notification = builder.build()
    runCatching {
      NotificationManagerCompat.from(context)
        .notify(candidate.id.hashCode(), notification)
    }
  }

  private fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    manager.createNotificationChannel(
      NotificationChannel(
        CHANNEL_ID,
        "收支记录与待核对",
        NotificationManager.IMPORTANCE_HIGH,
      ).apply {
        description = "自动记录结果、待核对交易和采集服务异常"
        enableVibration(true)
      },
    )
  }

  private fun formatAmount(amountMinor: Long): String {
    return "¥%.2f".format(amountMinor / 100.0)
  }
}

class ExpenseUndoReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val transactionId = intent?.getStringExtra(EXTRA_TRANSACTION_ID) ?: return
    val notificationId = intent.getIntExtra(EXTRA_NOTIFICATION_ID, 0)
    val pendingResult = goAsync()
    EXECUTOR.execute {
      try {
        ExpenseRepository(context.applicationContext).deleteTransaction(transactionId)
        if (notificationId != 0) {
          NotificationManagerCompat.from(context).cancel(notificationId)
        }
      } finally {
        pendingResult.finish()
      }
    }
  }

  companion object {
    const val EXTRA_TRANSACTION_ID = "transactionId"
    const val EXTRA_NOTIFICATION_ID = "notificationId"
    private val EXECUTOR = Executors.newSingleThreadExecutor()
  }
}
