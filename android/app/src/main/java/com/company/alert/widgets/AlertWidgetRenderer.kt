package com.company.alert.widgets

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import androidx.core.content.ContextCompat
import com.company.alert.MainActivity
import com.company.alert.R

object AlertWidgetRenderer {
  fun bind(
    context: Context,
    views: RemoteViews,
    layoutResId: Int,
    widgetId: Int,
    fallbackPreset: String,
  ) {
    val preset = AlertWidgetStore.getPresetForInstance(context, widgetId)
      ?: AlertWidgetStore.getDefaultPreset(context)
      ?: fallbackPreset
    val snapshot = AlertWidgetStore.getSnapshot(context, preset)
    when (layoutResId) {
      R.layout.widget_alert_small -> bindStatusSmall(context, views, snapshot)
      R.layout.widget_alert_small_alt -> bindRoute(context, views, snapshot)
      R.layout.widget_alert_medium -> bindAttentionLocal(context, views, snapshot)
      R.layout.widget_alert_large -> bindStatusLocal(context, views, snapshot)
    }
    val deeplink = snapshot?.deeplink ?: "alertapp://home"
    setRootClick(context, views, layoutResId, widgetId, deeplink)
  }

  private fun bindStatusSmall(
    context: Context,
    views: RemoteViews,
    snapshot: WidgetSnapshotModel?,
  ) {
    val title = snapshot?.title?.ifBlank { context.getString(R.string.widget_status) }
      ?: context.getString(R.string.widget_status)
    val metric = snapshot?.metric?.ifBlank { context.getString(R.string.widget_metric_value) }
      ?: context.getString(R.string.widget_metric_value)
    val statusLabel = snapshot?.statusBadge?.label?.ifBlank {
      context.getString(R.string.widget_attention_area)
    } ?: context.getString(R.string.widget_attention_area)

    val tone = resolveTone(snapshot)
    views.setTextViewText(R.id.widget_small_title, title)
    views.setTextViewText(R.id.widget_small_metric, metric)
    views.setTextViewText(R.id.widget_small_pill, statusLabel)
    views.setInt(R.id.widget_small_ring, "setBackgroundResource", ringDrawableForTone(tone))
    views.setInt(R.id.widget_small_pill, "setBackgroundResource", pillDrawableForTone(tone))
    views.setViewVisibility(
      R.id.widget_small_alert_icon,
      if (tone == WidgetTone.CRITICAL || tone == WidgetTone.WARNING) android.view.View.VISIBLE else android.view.View.INVISIBLE,
    )
  }

  private fun bindRoute(
    context: Context,
    views: RemoteViews,
    snapshot: WidgetSnapshotModel?,
  ) {
    val title = snapshot?.title?.ifBlank { context.getString(R.string.widget_route_title) }
      ?: context.getString(R.string.widget_route_title)
    val metric = snapshot?.metric?.ifBlank { context.getString(R.string.widget_route_eta) }
      ?: context.getString(R.string.widget_route_eta)
    val subtitle = snapshot?.subtitle?.ifBlank { context.getString(R.string.widget_route_destination) }
      ?: context.getString(R.string.widget_route_destination)
    val statusLabel = snapshot?.statusBadge?.label?.ifBlank {
      context.getString(R.string.widget_route_status)
    } ?: context.getString(R.string.widget_route_status)
    val tone = resolveTone(snapshot)

    views.setTextViewText(R.id.widget_small_alt_title, title)
    views.setTextViewText(R.id.widget_small_alt_eta, metric)
    views.setTextViewText(R.id.widget_small_alt_destination, subtitle)
    views.setTextViewText(R.id.widget_small_alt_pill, statusLabel)
    views.setInt(R.id.widget_small_alt_pill, "setBackgroundResource", pillDrawableForTone(tone))
  }

  private fun bindAttentionLocal(
    context: Context,
    views: RemoteViews,
    snapshot: WidgetSnapshotModel?,
  ) {
    val title = snapshot?.subtitle?.ifBlank { snapshot.title }
      ?.ifBlank { context.getString(R.string.widget_attention_local) }
      ?: context.getString(R.string.widget_attention_local)
    val metric = snapshot?.metric?.ifBlank { context.getString(R.string.widget_metric_value) }
      ?: context.getString(R.string.widget_metric_value)
    val tone = resolveTone(snapshot)

    views.setTextViewText(R.id.widget_medium_metric, metric)
    views.setTextViewText(R.id.widget_medium_title, title)
    views.setInt(R.id.widget_medium_ring, "setBackgroundResource", ringDrawableForTone(tone))
    views.setInt(R.id.widget_medium_info, "setColorFilter", ContextCompat.getColor(context, iconTintForTone(tone)))
  }

  private fun bindStatusLocal(
    context: Context,
    views: RemoteViews,
    snapshot: WidgetSnapshotModel?,
  ) {
    val title = snapshot?.title?.ifBlank { context.getString(R.string.widget_status_local) }
      ?: context.getString(R.string.widget_status_local)
    val statusLabel = snapshot?.statusBadge?.label?.ifBlank {
      context.getString(R.string.widget_attention_area)
    } ?: context.getString(R.string.widget_attention_area)
    val tone = resolveTone(snapshot)

    views.setTextViewText(R.id.widget_large_title, title)
    views.setTextViewText(R.id.widget_large_pill, statusLabel)
    views.setInt(R.id.widget_large_pill, "setBackgroundResource", pillDrawableForTone(tone))

    val segments = snapshot?.segments ?: emptyList()
    val bars = listOf(
      R.id.widget_large_bar_1,
      R.id.widget_large_bar_2,
      R.id.widget_large_bar_3,
      R.id.widget_large_bar_4,
      R.id.widget_large_bar_5,
    )
    bars.forEachIndexed { index, barId ->
      val value = segments.getOrNull(index) ?: snapshot?.level ?: 0
      views.setInt(barId, "setBackgroundResource", barDrawableForLevel(value))
    }
  }

  private fun setRootClick(
    context: Context,
    views: RemoteViews,
    layoutResId: Int,
    widgetId: Int,
    deeplink: String,
  ) {
    val rootId = when (layoutResId) {
      R.layout.widget_alert_small -> R.id.widget_small_root
      R.layout.widget_alert_small_alt -> R.id.widget_small_alt_root
      R.layout.widget_alert_medium -> R.id.widget_medium_root
      R.layout.widget_alert_large -> R.id.widget_large_root
      else -> null
    } ?: return

    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deeplink)).apply {
      setClass(context, MainActivity::class.java)
      flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
    }
    val pendingIntent = PendingIntent.getActivity(
      context,
      widgetId,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    views.setOnClickPendingIntent(rootId, pendingIntent)
  }

  private fun resolveTone(snapshot: WidgetSnapshotModel?): WidgetTone {
    val label = snapshot?.statusBadge?.tone?.lowercase()?.trim().orEmpty()
    return when {
      label.contains("critical") || label.contains("high") -> WidgetTone.CRITICAL
      label.contains("warning") || label.contains("moderate") || label.contains("attention") -> WidgetTone.WARNING
      else -> WidgetTone.SAFE
    }
  }

  private fun ringDrawableForTone(tone: WidgetTone) = when (tone) {
    WidgetTone.SAFE -> R.drawable.widget_ring_green
    WidgetTone.WARNING -> R.drawable.widget_ring_yellow
    WidgetTone.CRITICAL -> R.drawable.widget_ring_red
  }

  private fun pillDrawableForTone(tone: WidgetTone) = when (tone) {
    WidgetTone.SAFE -> R.drawable.widget_pill_green
    WidgetTone.WARNING -> R.drawable.widget_pill_yellow
    WidgetTone.CRITICAL -> R.drawable.widget_pill_red
  }

  private fun barDrawableForLevel(level: Int): Int {
    return when {
      level >= 70 -> R.drawable.widget_bar_red
      level >= 42 -> R.drawable.widget_bar_yellow
      else -> R.drawable.widget_bar_green
    }
  }

  private fun iconTintForTone(tone: WidgetTone): Int {
    return when (tone) {
      WidgetTone.SAFE -> R.color.widget_icon_tint
      WidgetTone.WARNING -> R.color.widget_ring_yellow
      WidgetTone.CRITICAL -> R.color.widget_ring_red
    }
  }
}

private enum class WidgetTone {
  SAFE,
  WARNING,
  CRITICAL,
}
