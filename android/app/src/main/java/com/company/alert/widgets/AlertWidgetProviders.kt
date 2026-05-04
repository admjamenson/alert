package com.company.alert.widgets

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.company.alert.R

abstract class BaseAlertWidgetProvider : AppWidgetProvider() {
  protected abstract val layoutResId: Int
  protected abstract val fallbackPreset: String

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    appWidgetIds.forEach { widgetId ->
      val views = RemoteViews(context.packageName, layoutResId)
      AlertWidgetRenderer.bind(
        context = context,
        views = views,
        layoutResId = layoutResId,
        widgetId = widgetId,
        fallbackPreset = fallbackPreset,
      )
      appWidgetManager.updateAppWidget(widgetId, views)
    }
  }

  override fun onReceive(context: Context, intent: Intent) {
    super.onReceive(context, intent)
    if (AppWidgetManager.ACTION_APPWIDGET_UPDATE == intent.action) {
      val manager = AppWidgetManager.getInstance(context)
      val component = ComponentName(context, this::class.java)
      val ids = manager.getAppWidgetIds(component)
      onUpdate(context, manager, ids)
    }
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: android.os.Bundle,
  ) {
    val views = RemoteViews(context.packageName, layoutResId)
    AlertWidgetRenderer.bind(
      context = context,
      views = views,
      layoutResId = layoutResId,
      widgetId = appWidgetId,
      fallbackPreset = fallbackPreset,
    )
    appWidgetManager.updateAppWidget(appWidgetId, views)
  }
}

class AlertWidgetSmallProvider : BaseAlertWidgetProvider() {
  override val layoutResId: Int = R.layout.widget_alert_small
  override val fallbackPreset: String = AlertWidgetStore.PRESET_STATUS
}

class AlertWidgetSmallAltProvider : BaseAlertWidgetProvider() {
  override val layoutResId: Int = R.layout.widget_alert_small_alt
  override val fallbackPreset: String = AlertWidgetStore.PRESET_ROUTE
}

class AlertWidgetMediumProvider : BaseAlertWidgetProvider() {
  override val layoutResId: Int = R.layout.widget_alert_medium
  override val fallbackPreset: String = AlertWidgetStore.PRESET_LOCAL_ATTENTION
}

class AlertWidgetLargeProvider : BaseAlertWidgetProvider() {
  override val layoutResId: Int = R.layout.widget_alert_large
  override val fallbackPreset: String = AlertWidgetStore.PRESET_STATUS_LOCAL
}
