import { Platform } from 'react-native';
import { appleBillingClient } from './AppleBillingClient';

export type BillingProvider = 'stripe' | 'app_store' | 'play';

export type BillingContext = {
  provider: BillingProvider;
  platform: 'ios' | 'android' | 'web' | 'unknown';
};

export const resolveBillingProvider = (): BillingContext => {
  if (Platform.OS === 'ios') {
    return { provider: 'app_store', platform: 'ios' };
  }

  if (Platform.OS === 'android') {
    return { provider: 'stripe', platform: 'android' };
  }

  return { provider: 'stripe', platform: 'unknown' };
};

/**
 * Initialize billing provider for the current platform
 * Must be called early in app lifecycle
 */
export const initializeBillingProvider = async (): Promise<void> => {
  const context = resolveBillingProvider();

  if (context.provider === 'app_store' && context.platform === 'ios') {
    try {
      console.log('[BillingProvider] Initializing App Store billing...');
      await appleBillingClient.initialize();
      console.log(
        '[BillingProvider] App Store billing initialized successfully',
      );
    } catch (error) {
      console.error(
        '[BillingProvider] Failed to initialize App Store billing:',
        error,
      );
      // Don't throw - allow app to continue without billing if initialization fails
    }
  }
};

/**
 * Cleanup billing provider resources
 * Should be called when app is terminating
 */
export const cleanupBillingProvider = async (): Promise<void> => {
  const context = resolveBillingProvider();

  if (context.provider === 'app_store') {
    try {
      await appleBillingClient.disconnect();
    } catch (error) {
      console.error('[BillingProvider] Cleanup error:', error);
    }
  }
};
