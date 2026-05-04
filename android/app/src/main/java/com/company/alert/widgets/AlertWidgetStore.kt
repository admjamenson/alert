package com.company.alert.widgets

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

data class WidgetStatusBadge(
  val label: String,
  val tone: String,
)

data class WidgetSnapshotModel(
  val preset: String,
  val title: String,
  val subtitle: String,
  val metric: String,
  val statusBadge: WidgetStatusBadge?,
  val level: Int?,
  val segments: List<Int>,
  val deeplink: String,
)

object AlertWidgetStore {
  private const val PREFS = "alert_widget_store"
  private const val KEY_SNAPSHOTS = "snapshots_json"
  private const val KEY_DEFAULT_PRESET = "default_preset"
  private const val KEY_INSTANCE_PREFIX = "instance_"

  const val PRESET_STATUS = "risk_now"
  const val PRESET_ROUTE = "commute"
  const val PRESET_LOCAL_ATTENTION = "alerts_ticker"
  const val PRESET_STATUS_LOCAL = "city_pulse"

  fun saveSnapshots(context: Context, payload: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_SNAPSHOTS, payload)
      .apply()
  }

  fun getDefaultPreset(context: Context): String? {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_DEFAULT_PRESET, null)
  }

  fun setDefaultPreset(context: Context, preset: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString(KEY_DEFAULT_PRESET, preset)
      .apply()
  }

  fun setPresetForInstance(context: Context, widgetId: Int, preset: String) {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .edit()
      .putString("${KEY_INSTANCE_PREFIX}${widgetId}", preset)
      .apply()
  }

  fun getPresetForInstance(context: Context, widgetId: Int): String? {
    return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString("${KEY_INSTANCE_PREFIX}${widgetId}", null)
  }

  fun getSnapshot(context: Context, preset: String): WidgetSnapshotModel? {
    val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      .getString(KEY_SNAPSHOTS, null)
      ?: return null
    return parseSnapshot(raw, preset)
  }

  private fun parseSnapshot(raw: String, preset: String): WidgetSnapshotModel? {
    val payload = runCatching { JSONObject(raw) }.getOrNull() ?: return null
    val snapshots = payload.optJSONObject("snapshots") ?: return null
    val snapshot = snapshots.optJSONObject(preset) ?: return null

    val status = snapshot.optJSONObject("statusBadge")
    val statusBadge = status?.let {
      WidgetStatusBadge(
        label = it.optString("label", ""),
        tone = it.optString("tone", ""),
      )
    }

    val visual = snapshot.optJSONObject("visual")
    val level = if (visual?.has("level") == true) visual.optInt("level") else null
    val segments = mutableListOf<Int>()
    val segmentArray: JSONArray? = visual?.optJSONArray("segmentProfile")
    if (segmentArray != null) {
      for (i in 0 until segmentArray.length()) {
        segments.add(segmentArray.optInt(i))
      }
    }

    return WidgetSnapshotModel(
      preset = snapshot.optString("preset", preset),
      title = snapshot.optString("title", ""),
      subtitle = snapshot.optString("subtitle", ""),
      metric = snapshot.optString("metric", ""),
      statusBadge = statusBadge,
      level = level,
      segments = segments,
      deeplink = snapshot.optString("deeplink", "alertapp://home"),
    )
  }
}
