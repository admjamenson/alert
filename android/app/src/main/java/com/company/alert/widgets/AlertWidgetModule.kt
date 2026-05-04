package com.company.alert.widgets

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.os.Bundle
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class AlertWidgetModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName(): String = "AlertWidget"

  @ReactMethod
  fun setSnapshots(payload: String) {
    AlertWidgetStore.saveSnapshots(context, payload)
    AlertWidgetUpdater.updateAll(context)
  }

  @ReactMethod
  fun reloadAll() {
    AlertWidgetUpdater.updateAll(context)
  }

  @ReactMethod
  fun setWidgetPreset(widgetInstanceId: Int, preset: String) {
    AlertWidgetStore.setPresetForInstance(context, widgetInstanceId, preset)
    AlertWidgetUpdater.updateAll(context)
  }

  @ReactMethod
  fun setDefaultPreset(preset: String) {
    AlertWidgetStore.setDefaultPreset(context, preset)
  }

  @ReactMethod
  fun canRequestPinWidget(): Boolean {
    val manager = AppWidgetManager.getInstance(context)
    return manager.isRequestPinAppWidgetSupported
  }

  @ReactMethod
  fun requestPinWidget(preset: String): Boolean {
    val manager = AppWidgetManager.getInstance(context)
    if (!manager.isRequestPinAppWidgetSupported) return false

    val provider = when (preset) {
      AlertWidgetStore.PRESET_ROUTE -> ComponentName(context, AlertWidgetSmallAltProvider::class.java)
      AlertWidgetStore.PRESET_LOCAL_ATTENTION -> ComponentName(context, AlertWidgetMediumProvider::class.java)
      AlertWidgetStore.PRESET_STATUS_LOCAL -> ComponentName(context, AlertWidgetLargeProvider::class.java)
      else -> ComponentName(context, AlertWidgetSmallProvider::class.java)
    }
    val extras = Bundle().apply {
      putString("widget_preset", preset)
    }
    return manager.requestPinAppWidget(provider, extras, null)
  }
}
