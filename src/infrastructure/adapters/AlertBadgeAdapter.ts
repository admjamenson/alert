import { NativeModules, Platform } from 'react-native';

type AlertBadgeModuleShape = {
  isSupported?: () => Promise<boolean> | boolean;
  setBadgeCount?: (count: number) => Promise<boolean> | boolean;
  clearBadgeCount?: () => Promise<boolean> | boolean;
};

const nativeModule = NativeModules.AlertBadgeModule as AlertBadgeModuleShape | undefined;

export const normalizeBadgeCount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 0;
  }
  return Math.max(0, Math.floor(numeric));
};

const callIfPresent = async (
  method: keyof AlertBadgeModuleShape,
  ...args: number[]
): Promise<boolean> => {
  if (!nativeModule || typeof nativeModule[method] !== 'function') {
    return false;
  }
  const result = await (nativeModule[method] as (...innerArgs: number[]) => Promise<boolean> | boolean)(
    ...args,
  );
  return Boolean(result);
};

export const AlertBadgeAdapter = {
  async syncUnreadCount(count: unknown): Promise<boolean> {
    if (Platform.OS !== 'android') {
      return false;
    }

    const normalized = normalizeBadgeCount(count);
    try {
      if (normalized <= 0) {
        return await callIfPresent('clearBadgeCount');
      }
      return await callIfPresent('setBadgeCount', normalized);
    } catch {
      return false;
    }
  },
};
