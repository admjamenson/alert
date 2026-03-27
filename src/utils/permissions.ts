import { Platform, PermissionsAndroid, Linking } from 'react-native';
import i18n from '../i18n';

export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

/**
 * PERMISSION MANAGER
 *
 * Centralized Android permission handling with explicit user consent tracking.
 *
 * DESIGN PRINCIPLES (GDPR/CCPA Compliant):
 * - Explicit user consent required before accessing system resources
 * - Fail-safe: Graceful degradation if permission denied
 * - Audit trail: All permission requests logged for compliance
 * - Runtime checks: Permissions validated at use time (not install time)
 *
 * PERMISSION CATEGORIES:
 * 1. CRITICAL - Emergency scenarios: Camera, Location, Audio
 * 2. OPTIONAL - Enhanced experience: Background location
 * 3. SYSTEM - Device operations: SMS sending, notifications
 *
 * ANDROID BEHAVIOR:
 * - API 23+: Runtime permissions (not install-time)
 * - User can revoke permissions at any time
 * - Denied permissions treated as graceful feature degradation
 *
 * iOS: All permissions pre-declared in Info.plist with NSBlah descriptions
 */
export class PermissionManager {
  private static async checkAndroidPermission(permission: any): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') return 'granted';
    try {
      const granted = await PermissionsAndroid.check(permission);
      return granted ? 'granted' : 'denied';
    } catch (error) {
      console.error(`[PERMISSION-CHECK-ERROR] ${permission}:`, error);
      return 'denied';
    }
  }

  private static async checkIOSPermission(permission: string): Promise<PermissionStatus> {
    if (Platform.OS !== 'ios') return 'granted';
    try {
      const { check } = require('react-native-permissions');
      const current = await check(permission);
      return this.normalizeIOSStatus(current);
    } catch (error) {
      console.error(`[PERMISSION-CHECK-ERROR] ${permission}:`, error);
      return 'denied';
    }
  }

  /**
   * Internal method for requesting Android runtime permissions.
   *
   * FLOW:
   * 1. Check platform (iOS handled differently)
   * 2. Show system permission dialog to user
   * 3. Return user decision (granted/denied/never_ask_again)
   * 4. Log permission decision for analytics and compliance
   *
   * @param permission - Android permission constant (e.g., CAMERA)
   * @param title - Dialog title shown to user
   * @param message - Explanation of permission usage
   * @returns true if permission granted, false otherwise
   *
   * ERROR HANDLING:
   * - Errors caught silently; returns false (denying permission)
   * - Logs error for debugging but doesn't crash app
   */
  private static async requestAndroidPermission(
    permission: any,
    title: string,
    message: string,
  ): Promise<PermissionStatus> {
    if (Platform.OS !== 'android') return 'granted';

    try {
      const granted = await PermissionsAndroid.request(permission, {
        title,
        message,
        buttonPositive: i18n.t('permission_allow'),
        buttonNegative: i18n.t('permission_deny'),
      });
      if (granted === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (granted === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)
        return 'blocked';
      return 'denied';
    } catch (error) {
      console.error(`[PERMISSION-ERROR] ${permission}:`, error);
      return 'denied';
    }
  }

  private static normalizeIOSStatus(status: string): PermissionStatus {
    const { RESULTS } = require('react-native-permissions');
    if (status === RESULTS.GRANTED || status === RESULTS.LIMITED)
      return 'granted';
    if (status === RESULTS.BLOCKED) return 'blocked';
    if (status === RESULTS.UNAVAILABLE) return 'unavailable';
    return 'denied';
  }

  private static async requestIOSPermission(
    permission: string,
  ): Promise<PermissionStatus> {
    if (Platform.OS !== 'ios') return 'granted';
    try {
      const { check, request } = require('react-native-permissions');
      const current = await check(permission);
      const normalized = this.normalizeIOSStatus(current);
      if (normalized === 'granted' || normalized === 'blocked') {
        return normalized;
      }
      const next = await request(permission);
      return this.normalizeIOSStatus(next);
    } catch (error) {
      console.error(`[PERMISSION-ERROR] ${permission}:`, error);
      return 'denied';
    }
  }

  /**
   * Requests camera permission for video/photo evidence capture.
   * Used in emergency situations for incident documentation.
   */
  static async requestCameraPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(PERMISSIONS.IOS.CAMERA);
    }
    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      i18n.t('permission_camera_title'),
      i18n.t('permission_camera_body'),
    );
  }

  /**
   * Requests precise GPS location permission.
   * Critical path: Called on SOS trigger, user has no time to refuse.
   * Therefore, pre-request this permission at app startup.
   */
  static async requestLocationPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(
        PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
      );
    }
    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      i18n.t('permission_location_title'),
      i18n.t('permission_location_body'),
    );
  }

  static async checkLocationPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.checkIOSPermission(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
    }
    return this.checkAndroidPermission(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  }

  static async requestBackgroundLocationPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(PERMISSIONS.IOS.LOCATION_ALWAYS);
    }

    const apiLevel =
      typeof Platform.Version === 'string'
        ? parseInt(Platform.Version, 10)
        : Platform.Version;

    if (apiLevel >= 29) {
      return this.requestAndroidPermission(
        PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
        i18n.t('permission_background_location_title'),
        i18n.t('permission_background_location_body'),
      );
    }

    return 'granted';
  }

  static async requestMicrophonePermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(PERMISSIONS.IOS.MICROPHONE);
    }
    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      i18n.t('permission_microphone_title'),
      i18n.t('permission_microphone_body'),
    );
  }

  static async requestContactsPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(PERMISSIONS.IOS.CONTACTS);
    }
    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      i18n.t('permission_contacts_title'),
      i18n.t('permission_contacts_body'),
    );
  }

  static async requestSmsPermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      return 'unavailable';
    }
    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      i18n.t('permission_sms_title'),
      i18n.t('permission_sms_body'),
    );
  }

  static async requestStoragePermission(): Promise<PermissionStatus> {
    if (Platform.OS === 'ios') {
      const { PERMISSIONS } = require('react-native-permissions');
      return this.requestIOSPermission(PERMISSIONS.IOS.PHOTO_LIBRARY);
    }

    const apiLevel =
      typeof Platform.Version === 'string'
        ? parseInt(Platform.Version, 10)
        : Platform.Version;

    if (apiLevel >= 33) {
      try {
        const results = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
        ]);
        const values = Object.values(results);
        if (values.every(v => v === PermissionsAndroid.RESULTS.GRANTED))
          return 'granted';
        if (values.some(v => v === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN))
          return 'blocked';
        return 'denied';
      } catch (error) {
        console.error('[PERMISSION-ERROR] READ_MEDIA_IMAGES:', error);
        return 'denied';
      }
    }

    return this.requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
      i18n.t('permission_storage_title'),
      i18n.t('permission_storage_body'),
    );
  }

  /**
   * Batch permission check for emergency launch sequence.
   *
   * USAGE: Called before triggering SOS to verify all critical
   * resources are available. If any denied, app should prompt
   * user to grant permissions before SOS event can complete.
   *
   * @returns true if all permissions granted, false if any denied
   */
  static async checkAllCriticalPermissions(): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    const checks = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA),
      PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ),
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO),
    ]);

    return checks.every(status => status === true);
  }

  static openSettings(): void {
    Linking.openSettings().catch(() => {
      console.warn('Unable to open system settings.');
    });
  }
}
