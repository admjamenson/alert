import { NativeModules } from 'react-native';
import { WidgetSnapshot } from '../domain/WidgetSnapshot';
import { WidgetPreset } from '../domain/WidgetPreset';

type AlertWidgetNative = {
  setSnapshots?: (json: string) => Promise<void> | void;
  reloadAll?: () => Promise<void> | void;
  setWidgetPreset?: (widgetInstanceId: number, preset: WidgetPreset) => Promise<void> | void;
  setDefaultPreset?: (preset: WidgetPreset) => Promise<void> | void;
  canRequestPinWidget?: () => Promise<boolean> | boolean;
  requestPinWidget?: (preset: WidgetPreset) => Promise<boolean> | boolean;
};

const getNativeModule = (): AlertWidgetNative | null => {
  const mod = (NativeModules as any)?.AlertWidget as AlertWidgetNative | undefined;
  return mod || null;
};

export interface IWidgetBridgeAdapter {
  pushSnapshots(snapshots: WidgetSnapshot[]): Promise<void>;
  reloadAll(): Promise<void>;
  setWidgetPreset(widgetInstanceId: number, preset: WidgetPreset): Promise<void>;
  setDefaultPreset(preset: WidgetPreset): Promise<void>;
  canRequestPinWidget(): Promise<boolean>;
  requestPinWidget(preset: WidgetPreset): Promise<boolean>;
}

export class WidgetBridge implements IWidgetBridgeAdapter {
  async pushSnapshots(snapshots: WidgetSnapshot[]): Promise<void> {
    const native = getNativeModule();
    if (!native?.setSnapshots) return;
    const payload = {
      v: 3,
      generatedAt: new Date().toISOString(),
      snapshots: snapshots.reduce<Record<string, WidgetSnapshot>>((acc, snapshot) => {
        acc[snapshot.preset] = snapshot;
        return acc;
      }, {}),
    };
    try {
      await native.setSnapshots(JSON.stringify(payload));
    } catch {
      // fail-soft
    }
  }

  async reloadAll(): Promise<void> {
    const native = getNativeModule();
    if (!native?.reloadAll) return;
    try {
      await native.reloadAll();
    } catch {
      // fail-soft
    }
  }

  async setWidgetPreset(widgetInstanceId: number, preset: WidgetPreset): Promise<void> {
    const native = getNativeModule();
    if (!native?.setWidgetPreset) return;
    try {
      await native.setWidgetPreset(widgetInstanceId, preset);
    } catch {
      // fail-soft
    }
  }

  async setDefaultPreset(preset: WidgetPreset): Promise<void> {
    const native = getNativeModule();
    if (!native?.setDefaultPreset) return;
    try {
      await native.setDefaultPreset(preset);
    } catch {
      // fail-soft
    }
  }

  async canRequestPinWidget(): Promise<boolean> {
    const native = getNativeModule();
    if (!native?.canRequestPinWidget) return false;
    try {
      return Boolean(await native.canRequestPinWidget());
    } catch {
      return false;
    }
  }

  async requestPinWidget(preset: WidgetPreset): Promise<boolean> {
    const native = getNativeModule();
    if (!native?.requestPinWidget) return false;
    try {
      return Boolean(await native.requestPinWidget(preset));
    } catch {
      return false;
    }
  }
}

export const widgetBridge = new WidgetBridge();
