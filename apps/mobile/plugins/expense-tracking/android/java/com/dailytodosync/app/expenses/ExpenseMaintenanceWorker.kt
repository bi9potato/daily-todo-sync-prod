package com.dailytodosync.app.expenses

import android.content.Context
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

class ExpenseDiagnosticCleanupWorker(
  appContext: Context,
  workerParameters: WorkerParameters,
) : Worker(appContext, workerParameters) {
  override fun doWork(): Result {
    return try {
      ExpenseRepository(applicationContext).clearExpiredDiagnosticSamples()
      Result.success()
    } catch (_: Throwable) {
      Result.retry()
    }
  }

  companion object {
    private const val UNIQUE_WORK_NAME = "expense-diagnostic-cleanup"

    fun schedule(context: Context) {
      val request = PeriodicWorkRequestBuilder<ExpenseDiagnosticCleanupWorker>(
        1,
        TimeUnit.DAYS,
      ).build()
      WorkManager.getInstance(context.applicationContext)
        .enqueueUniquePeriodicWork(
          UNIQUE_WORK_NAME,
          ExistingPeriodicWorkPolicy.KEEP,
          request,
        )
    }
  }
}
