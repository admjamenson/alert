package com.company.alert.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews
import com.company.alert.R

object AlertWidgetUpdater {
  fun updateAll(context: Context) {
    val manager = AppWidgetManager.getInstance(context)
    updateProvider(context, manager, AlertWidgetSmallProvider::class.java, R.layout.widget_alert_small)
    updateProvider(context, manager, AlertWidgetSmallAltProvider::class.java, R.layout.widget_alert_small_alt)
    updateProvider(context, manager, AlertWidgetMediumProvider::class.java, R.layout.widget_alert_medium)
    updateProvider(context, manager, AlertWidgetLargeProvider::class.java, R.layout.widget_alert_large)
  }

  private fun updateProvider(
    context: Context,
    manager: AppWidgetManager,
    provider: Class<*>,
    layoutResId: Int,
  ) {
    val component = ComponentName(context, provider)
    val ids = manager.getAppWidgetIds(component)
    if (ids.isEmpty()) return
    ids.forEach { widgetId ->
      val views = RemoteViews(context.packageName, layoutResId)
      val fallback = when (layoutResId) {
        R.layout.widget_alert_small -> AlertWidgetStore.PRESET_STATUS
        R.layout.widget_alert_small_alt -> AlertWidgetStore.PRESET_ROUTE
        R.layout.widget_alert_medium -> AlertWidgetStore.PRESET_LOCAL_ATTENTION
        R.layout.widget_alert_large -> AlertWidgetStore.PRESET_STATUS_LOCAL
        else -> AlertWidgetStore.PRESET_STATUS
      }
      AlertWidgetRenderer.bind(context, views, layoutResId, widgetId, fallback)
      manager.updateAppWidget(widgetId, views)
    }
  }
}
