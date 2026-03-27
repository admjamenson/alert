import { NativeEventEmitter, NativeModules } from 'react-native';

type BillingBrowserNativeModule = {
  isAvailable?: () => Promise<boolean> | boolean;
  open?: (url: string) => Promise<boolean> | boolean;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const BILLING_BROWSER_DISMISS_EVENT = 'AlertBillingBrowserDidDismiss';

const nativeModule = NativeModules.AlertBillingBrowserModule as
  | BillingBrowserNativeModule
  | undefined;

const getEmitter = () => {
  if (!nativeModule) {
    return null;
  }

  try {
    return new NativeEventEmitter(nativeModule as never);
  } catch {
    return null;
  }
};

const normalizeUrl = (value: unknown) => String(value || '').trim();

export const BillingBrowserAdapter = {
  async isAvailable(): Promise<boolean> {
    if (!nativeModule || typeof nativeModule.isAvailable !== 'function') {
      return false;
    }

    try {
      return Boolean(await nativeModule.isAvailable());
    } catch {
      return false;
    }
  },

  async open(url: string): Promise<void> {
    const normalizedUrl = normalizeUrl(url);
    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new Error('invalid_billing_url');
    }

    if (!nativeModule || typeof nativeModule.open !== 'function') {
      throw new Error('billing_browser_unavailable');
    }

    await nativeModule.open(normalizedUrl);
  },

  addDismissListener(listener: () => void): () => void {
    const emitter = getEmitter();
    if (!emitter) {
      return () => undefined;
    }

    const subscription = emitter.addListener(BILLING_BROWSER_DISMISS_EVENT, listener);
    return () => {
      subscription.remove();
    };
  },
};

export { BILLING_BROWSER_DISMISS_EVENT };
