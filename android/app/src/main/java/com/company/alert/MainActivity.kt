package com.company.alert

import android.content.Intent
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate
import com.google.firebase.crashlytics.FirebaseCrashlytics

class MainActivity : ReactActivity() {
  companion object {
    private const val DEBUG_CRASHLYTICS_ACTION = "debug_crashlytics_action"
    private const val DEBUG_CRASHLYTICS_NOTE = "debug_crashlytics_note"
  }

  private val criticalOverlayHandler = Handler(Looper.getMainLooper())
  private var criticalLaunchOverlay: View? = null
  private var nativeStartupStartedAt: Long = 0

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "Alert"

  override fun onCreate(savedInstanceState: Bundle?) {
    nativeStartupStartedAt = SystemClock.uptimeMillis()
    logNativeStartup("NATIVE_ACTIVITY_ON_CREATE")
    super.onCreate(savedInstanceState)
    showCriticalLaunchOverlay()
    handleDebugCrashlyticsIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    handleDebugCrashlyticsIntent(intent)
  }

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  private fun showCriticalLaunchOverlay() {
    if (criticalLaunchOverlay != null) return

    val decor = window.decorView as? ViewGroup ?: return
    val overlay = FrameLayout(this).apply {
      setBackgroundColor(Color.WHITE)
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
      contentDescription = getString(R.string.critical_launch_status_loading)
      elevation = dp(24).toFloat()
    }

    val column = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setPadding(dp(28), dp(32), dp(28), dp(32))
    }

    val title = TextView(this).apply {
      text = getString(R.string.critical_launch_title)
      setTextColor(Color.parseColor("#E61C24"))
      textSize = 40f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      includeFontPadding = false
    }

    val status = TextView(this).apply {
      text = getString(R.string.critical_launch_status_loading)
      setTextColor(Color.parseColor("#242833"))
      textSize = 18f
      gravity = Gravity.CENTER
      includeFontPadding = true
      setPadding(0, dp(14), 0, dp(30))
    }

    val sosButton = TextView(this).apply {
      text = getString(R.string.critical_launch_sos_label)
      setTextColor(Color.WHITE)
      textSize = 54f
      typeface = Typeface.DEFAULT_BOLD
      gravity = Gravity.CENTER
      isClickable = true
      isFocusable = true
      contentDescription =
          "${getString(R.string.critical_launch_sos_accessibility)}. ${
            getString(R.string.critical_launch_sos_hint)
          }"
      background = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(Color.parseColor("#E61C24"))
      }
      accessibilityDelegate = object : View.AccessibilityDelegate() {
        override fun onInitializeAccessibilityNodeInfo(
            host: View,
            info: AccessibilityNodeInfo,
        ) {
          super.onInitializeAccessibilityNodeInfo(host, info)
          info.className = Button::class.java.name
        }
      }
      setOnClickListener {
        triggerNativeSosHandoff(status)
      }
    }

    column.addView(
        title,
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ),
    )
    column.addView(
        status,
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ),
    )
    column.addView(sosButton, LinearLayout.LayoutParams(dp(224), dp(224)))

    overlay.addView(
        column,
        FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ),
    )
    criticalLaunchOverlay = overlay
    decor.addView(
        overlay,
        ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ),
    )
    logNativeStartup("NATIVE_CRITICAL_OVERLAY_READY")
    criticalOverlayHandler.postDelayed({ dismissCriticalLaunchOverlay() }, 2200)
  }

  private fun triggerNativeSosHandoff(status: TextView) {
    triggerNativeHaptic()
    status.text = getString(R.string.critical_launch_sos_feedback)
    val handoffUrl = "alertapp://quick-sos?ts=${System.currentTimeMillis()}"
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(handoffUrl)).apply {
      setPackage(packageName)
      addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    runCatching { startActivity(intent) }
    criticalOverlayHandler.postDelayed({ dismissCriticalLaunchOverlay() }, 650)
  }

  private fun dismissCriticalLaunchOverlay() {
    val overlay = criticalLaunchOverlay ?: return
    criticalLaunchOverlay = null
    (overlay.parent as? ViewGroup)?.removeView(overlay)
    logNativeStartup("NATIVE_CRITICAL_OVERLAY_DISMISSED")
  }

  private fun logNativeStartup(phase: String) {
    val start = if (nativeStartupStartedAt > 0) nativeStartupStartedAt else SystemClock.uptimeMillis()
    val delta = SystemClock.uptimeMillis() - start
    Log.i("AlertStartup", "$phase +${delta}ms")
  }

  private fun handleDebugCrashlyticsIntent(intent: Intent?) {
    if (!BuildConfig.DEBUG || intent == null) return

    val action = intent.getStringExtra(DEBUG_CRASHLYTICS_ACTION)?.trim()?.lowercase() ?: return
    val note = intent.getStringExtra(DEBUG_CRASHLYTICS_NOTE)?.trim().orEmpty()
    intent.removeExtra(DEBUG_CRASHLYTICS_ACTION)
    intent.removeExtra(DEBUG_CRASHLYTICS_NOTE)

    val crashlytics = FirebaseCrashlytics.getInstance()
    val requestId = System.currentTimeMillis().toString()
    crashlytics.setCustomKey("debug_crashlytics_request_id", requestId)
    crashlytics.setCustomKey("debug_crashlytics_action", action)

    when (action) {
      "session" -> {
        crashlytics.log("Debug session ping requestId=$requestId note=$note")
        Log.i("AlertFirebase", "Crashlytics session ping requestId=$requestId note=$note")
      }

      "nonfatal" -> {
        val error = IllegalStateException("Controlled non-fatal Crashlytics test requestId=$requestId note=$note")
        crashlytics.recordException(error)
        crashlytics.log("Debug non-fatal recorded requestId=$requestId note=$note")
        Log.i("AlertFirebase", "Crashlytics non-fatal recorded requestId=$requestId note=$note")
      }

      "fatal" -> {
        crashlytics.log("Debug fatal armed requestId=$requestId note=$note")
        Log.i("AlertFirebase", "Crashlytics fatal armed requestId=$requestId note=$note")
        criticalOverlayHandler.post {
          throw RuntimeException("Controlled fatal Crashlytics test requestId=$requestId note=$note")
        }
      }

      else -> {
        Log.w("AlertFirebase", "Ignoring unknown Crashlytics debug action=$action")
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun triggerNativeHaptic() {
    val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator ?: return
    if (!vibrator.hasVibrator()) return
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
      vibrator.vibrate(VibrationEffect.createOneShot(40, VibrationEffect.DEFAULT_AMPLITUDE))
    } else {
      vibrator.vibrate(40)
    }
  }

  private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
