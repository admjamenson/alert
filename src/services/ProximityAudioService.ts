import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

type ProximityChange = { near: boolean };

type ProximityAudioNativeModule = {
  startMonitoring: () => Promise<boolean>;
  stopMonitoring: () => Promise<boolean>;
  addListener?: (eventName: string) => void;
  removeListeners?: (count: number) => void;
};

const nativeModule = NativeModules.ProximityAudioModule as ProximityAudioNativeModule | undefined;
const emitter =
  Platform.OS === 'android' && nativeModule ? new NativeEventEmitter(nativeModule as any) : null;

const listeners = new Set<(state: ProximityChange) => void>();
let subscription: { remove: () => void } | null = null;
let active = false;

const ensureEventSubscription = () => {
  if (!emitter || subscription) return;
  subscription = emitter.addListener('proximityAudioChanged', payload => {
    const near = Boolean(payload?.near);
    listeners.forEach(listener => listener({ near }));
  });
};

const clearEventSubscription = () => {
  if (!subscription) return;
  subscription.remove();
  subscription = null;
};

export const ProximityAudioService = {
  async start() {
    if (Platform.OS !== 'android' || !nativeModule?.startMonitoring) return false;
    ensureEventSubscription();
    try {
      const ok = await nativeModule.startMonitoring();
      active = Boolean(ok);
      return active;
    } catch {
      active = false;
      return false;
    }
  },

  async stop() {
    if (Platform.OS !== 'android' || !nativeModule?.stopMonitoring) return false;
    try {
      await nativeModule.stopMonitoring();
      active = false;
      if (listeners.size === 0) {
        clearEventSubscription();
      }
      return true;
    } catch {
      return false;
    }
  },

  isActive() {
    return active;
  },

  subscribe(listener: (state: ProximityChange) => void) {
    listeners.add(listener);
    ensureEventSubscription();
    return () => {
      listeners.delete(listener);
      if (!active && listeners.size === 0) {
        clearEventSubscription();
      }
    };
  },
};
