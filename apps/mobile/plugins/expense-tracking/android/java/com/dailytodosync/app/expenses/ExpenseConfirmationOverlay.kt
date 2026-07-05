package com.dailytodosync.app.expenses

import android.accessibilityservice.AccessibilityService
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

class ExpenseConfirmationOverlay(
  private val service: AccessibilityService,
) {
  private val handler = Handler(Looper.getMainLooper())
  private val windowManager =
    service.getSystemService(AccessibilityService.WINDOW_SERVICE) as WindowManager
  private var currentView: View? = null
  private var hideTask: Runnable? = null

  fun showRecorded(
    amountMinor: Long,
    category: String?,
    onUndo: () -> Unit,
  ) {
    val content = verticalContainer()
    content.addView(titleView("已记录 ${formatAmount(amountMinor)}"))
    content.addView(bodyView(category ?: "其他支出"))
    content.addView(actionButton("撤销") {
      dismiss()
      onUndo()
    })
    show(content, autoHideMillis = 4_000L)
  }

  fun showConfirmation(
    candidate: ExpenseCandidateRecord,
    onConfirm: () -> Unit,
    onReview: () -> Unit,
    onIgnore: () -> Unit,
  ) {
    val content = verticalContainer()
    content.addView(titleView("确认这笔交易？"))
    content.addView(
      bodyView(
        listOfNotNull(
          candidate.amountMinor?.let(::formatAmount),
          candidate.merchant,
          candidate.category,
        ).joinToString(" · ").ifBlank { "交易信息不完整" },
      ),
    )
    val actions = LinearLayout(service).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.END
    }
    actions.addView(actionButton("忽略") {
      dismiss()
      onIgnore()
    })
    actions.addView(actionButton("修改") {
      dismiss()
      onReview()
    })
    actions.addView(actionButton("确认") {
      dismiss()
      onConfirm()
    })
    content.addView(actions)
    show(content, autoHideMillis = null)
  }

  fun dismiss() {
    hideTask?.let(handler::removeCallbacks)
    hideTask = null
    currentView?.let { view -> runCatching { windowManager.removeView(view) } }
    currentView = null
  }

  private fun show(view: View, autoHideMillis: Long?) {
    dismiss()
    val params = WindowManager.LayoutParams(
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.WRAP_CONTENT,
      WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
      PixelFormat.TRANSLUCENT,
    ).apply {
      gravity = Gravity.TOP or Gravity.END
      x = dp(16)
      y = dp(72)
    }
    windowManager.addView(view, params)
    currentView = view
    if (autoHideMillis != null) {
      val task = Runnable(::dismiss)
      hideTask = task
      handler.postDelayed(task, autoHideMillis)
    }
  }

  private fun verticalContainer(): LinearLayout {
    return LinearLayout(service).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.START
      minimumWidth = dp(260)
      setPadding(dp(16), dp(14), dp(16), dp(12))
      background = GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = dp(14).toFloat()
        setColor(Color.rgb(255, 254, 250))
        setStroke(dp(1), Color.rgb(213, 221, 211))
      }
      elevation = dp(12).toFloat()
    }
  }

  private fun titleView(text: String): TextView {
    return TextView(service).apply {
      this.text = text
      setTextColor(Color.rgb(22, 27, 24))
      textSize = 16f
      setTypeface(typeface, android.graphics.Typeface.BOLD)
    }
  }

  private fun bodyView(text: String): TextView {
    return TextView(service).apply {
      this.text = text
      setTextColor(Color.rgb(104, 113, 104))
      textSize = 13f
      setPadding(0, dp(5), 0, dp(7))
    }
  }

  private fun actionButton(label: String, onClick: () -> Unit): Button {
    return Button(service).apply {
      text = label
      isAllCaps = false
      setOnClickListener { onClick() }
      setTextColor(Color.rgb(44, 87, 69))
      textSize = 13f
      minHeight = dp(38)
      minimumHeight = dp(38)
    }
  }

  private fun dp(value: Int): Int {
    return (value * service.resources.displayMetrics.density).toInt()
  }

  private fun formatAmount(amountMinor: Long): String {
    return "¥%.2f".format(amountMinor / 100.0)
  }
}
