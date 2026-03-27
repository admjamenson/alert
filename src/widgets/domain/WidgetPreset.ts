export type WidgetPreset = 'risk_now' | 'commute' | 'city_pulse' | 'alerts_ticker';

export const WIDGET_PRESETS: WidgetPreset[] = [
  'risk_now',
  'commute',
  'city_pulse',
  'alerts_ticker',
];

const WIDGET_PRESET_SET = new Set<WidgetPreset>(WIDGET_PRESETS);

export const isWidgetPreset = (value: unknown): value is WidgetPreset =>
  WIDGET_PRESET_SET.has(String(value || '').trim() as WidgetPreset);
