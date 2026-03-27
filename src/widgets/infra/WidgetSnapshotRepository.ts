import AsyncStorage from '@react-native-async-storage/async-storage';
import { isWidgetSnapshotValid } from '../domain/WidgetInvariants';
import { WidgetPreset, WIDGET_PRESETS } from '../domain/WidgetPreset';
import { WidgetSnapshot } from '../domain/WidgetSnapshot';

const SNAPSHOT_KEY_PREFIX = '@Alert:WidgetSnapshot:';
const ALL_SNAPSHOTS_KEY = '@Alert:WidgetSnapshotsV3';
const LEGACY_ALL_SNAPSHOTS_KEY = '@Alert:WidgetSnapshotsV2';
const INSTANCE_PRESET_MAP_KEY = '@Alert:WidgetInstancePresetMap';
const DEFAULT_PRESET_KEY = '@Alert:WidgetDefaultPreset';

type InstancePresetMap = Record<string, WidgetPreset>;

const parseJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const normalizePreset = (value: unknown): WidgetPreset | null => {
  const preset = String(value || '').trim() as WidgetPreset;
  return WIDGET_PRESETS.includes(preset) ? preset : null;
};

export interface IWidgetSnapshotRepository {
  getAll(): Promise<Record<WidgetPreset, WidgetSnapshot>>;
  getByPreset(preset: WidgetPreset): Promise<WidgetSnapshot | null>;
  saveMany(snapshots: WidgetSnapshot[]): Promise<void>;
  getDefaultPreset(): Promise<WidgetPreset>;
  setDefaultPreset(preset: WidgetPreset): Promise<void>;
  getPresetForInstance(widgetInstanceId: number): Promise<WidgetPreset | null>;
  setPresetForInstance(widgetInstanceId: number, preset: WidgetPreset): Promise<void>;
}

export class WidgetSnapshotRepository implements IWidgetSnapshotRepository {
  async getByPreset(preset: WidgetPreset): Promise<WidgetSnapshot | null> {
    const raw = await AsyncStorage.getItem(`${SNAPSHOT_KEY_PREFIX}${preset}`);
    const parsed = parseJson<WidgetSnapshot>(raw);
    if (!parsed || !isWidgetSnapshotValid(parsed)) return null;
    return parsed;
  }

  async getAll(): Promise<Record<WidgetPreset, WidgetSnapshot>> {
    const fromBundle = parseJson<Record<WidgetPreset, WidgetSnapshot>>(
      await AsyncStorage.getItem(ALL_SNAPSHOTS_KEY),
    );
    const fromLegacyBundle =
      fromBundle ||
      parseJson<Record<WidgetPreset, WidgetSnapshot>>(
        await AsyncStorage.getItem(LEGACY_ALL_SNAPSHOTS_KEY),
      );
    const merged: Partial<Record<WidgetPreset, WidgetSnapshot>> = {};

    WIDGET_PRESETS.forEach(preset => {
      const candidate = fromLegacyBundle?.[preset];
      if (candidate && isWidgetSnapshotValid(candidate)) {
        merged[preset] = candidate;
      }
    });

    if (Object.keys(merged).length === WIDGET_PRESETS.length) {
      return merged as Record<WidgetPreset, WidgetSnapshot>;
    }

    const pending = WIDGET_PRESETS.map(async preset => {
      if (merged[preset]) return;
      const snapshot = await this.getByPreset(preset);
      if (snapshot) merged[preset] = snapshot;
    });
    await Promise.all(pending);

    return merged as Record<WidgetPreset, WidgetSnapshot>;
  }

  async saveMany(snapshots: WidgetSnapshot[]): Promise<void> {
    const valid = snapshots.filter(snapshot => isWidgetSnapshotValid(snapshot));
    if (valid.length === 0) return;
    const record = {} as Record<WidgetPreset, WidgetSnapshot>;
    const writes: Array<[string, string]> = [];

    valid.forEach(snapshot => {
      record[snapshot.preset] = snapshot;
      writes.push([`${SNAPSHOT_KEY_PREFIX}${snapshot.preset}`, JSON.stringify(snapshot)]);
    });

    const payload = JSON.stringify(record);
    writes.push([ALL_SNAPSHOTS_KEY, payload]);
    writes.push([LEGACY_ALL_SNAPSHOTS_KEY, payload]);
    await AsyncStorage.multiSet(writes);
  }

  async getDefaultPreset(): Promise<WidgetPreset> {
    const raw = await AsyncStorage.getItem(DEFAULT_PRESET_KEY);
    return normalizePreset(raw) || 'risk_now';
  }

  async setDefaultPreset(preset: WidgetPreset): Promise<void> {
    await AsyncStorage.setItem(DEFAULT_PRESET_KEY, preset);
  }

  async getPresetForInstance(widgetInstanceId: number): Promise<WidgetPreset | null> {
    const raw = await AsyncStorage.getItem(INSTANCE_PRESET_MAP_KEY);
    const parsed = parseJson<InstancePresetMap>(raw) || {};
    return normalizePreset(parsed[String(widgetInstanceId)]);
  }

  async setPresetForInstance(widgetInstanceId: number, preset: WidgetPreset): Promise<void> {
    const raw = await AsyncStorage.getItem(INSTANCE_PRESET_MAP_KEY);
    const parsed = parseJson<InstancePresetMap>(raw) || {};
    parsed[String(widgetInstanceId)] = preset;
    await AsyncStorage.setItem(INSTANCE_PRESET_MAP_KEY, JSON.stringify(parsed));
  }
}

export const widgetSnapshotRepository = new WidgetSnapshotRepository();
