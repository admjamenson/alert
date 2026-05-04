package com.company.alert

import android.app.Application
import android.util.Log
import com.facebook.react.PackageList
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.ReactNativeHost
import com.facebook.react.ReactPackage
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.load
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.react.defaults.DefaultReactNativeHost
import com.facebook.react.soloader.OpenSourceMergedSoMapping
import com.facebook.soloader.SoLoader
import com.company.alert.widgets.AlertWidgetPackage
import com.google.firebase.FirebaseApp
import com.google.firebase.crashlytics.FirebaseCrashlytics

class MainApplication : Application(), ReactApplication {

  override val reactNativeHost: ReactNativeHost =
      object : DefaultReactNativeHost(this) {
        override fun getPackages(): List<ReactPackage> =
            PackageList(this).packages
                .filterNot { pkg ->
                  val name = pkg.javaClass.name
                  name == "com.swmansion.reanimated.ReanimatedPackage" ||
                      name == "com.swmansion.worklets.WorkletsPackage"
                }
                .toMutableList()
                .apply {
                  // Packages that cannot be autolinked yet can be added manually here, for example:
                  add(AlertWidgetPackage())
                }

        override fun getJSMainModuleName(): String = "index"

        override fun getUseDeveloperSupport(): Boolean =
            BuildConfig.DEBUG && !BuildConfig.BUNDLED_DEBUG_JS

        override val isNewArchEnabled: Boolean = BuildConfig.IS_NEW_ARCHITECTURE_ENABLED
        override val isHermesEnabled: Boolean = BuildConfig.IS_HERMES_ENABLED
      }

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, OpenSourceMergedSoMapping)
    bootstrapCrashlytics()
    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {
      // If you opted-in for the New Architecture, we load the native entry point for this app.
      load()
    }
  }

  private fun bootstrapCrashlytics() {
    val firebaseApp = FirebaseApp.initializeApp(this) ?: FirebaseApp.getApps(this).firstOrNull()
    val crashlytics = FirebaseCrashlytics.getInstance()

    if (BuildConfig.DEBUG) {
      crashlytics.setCrashlyticsCollectionEnabled(true)
      crashlytics.sendUnsentReports()
    }

    val previousCrash = crashlytics.didCrashOnPreviousExecution()
    val projectId = firebaseApp?.options?.projectId ?: "missing"
    val applicationId = firebaseApp?.options?.applicationId ?: "missing"

    crashlytics.setCustomKey("alert_project_id", projectId)
    crashlytics.setCustomKey("alert_application_id", applicationId)
    crashlytics.setCustomKey("alert_build_debug", BuildConfig.DEBUG)
    crashlytics.setCustomKey("alert_version_name", BuildConfig.VERSION_NAME)
    crashlytics.setCustomKey("alert_version_code", BuildConfig.VERSION_CODE.toString())
    crashlytics.log("Alert Crashlytics bootstrap project=$projectId appId=$applicationId")

    Log.i(
        "AlertFirebase",
        "Crashlytics bootstrap project=$projectId appId=$applicationId debug=${BuildConfig.DEBUG} previousCrash=$previousCrash version=${BuildConfig.VERSION_NAME}(${BuildConfig.VERSION_CODE})",
    )
  }
}
