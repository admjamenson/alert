import { WidgetPreset } from './WidgetPreset';

export type WidgetPreviewVariant =
  | 'risk_now_preview'
  | 'commute_preview'
  | 'city_pulse_preview'
  | 'alerts_ticker_preview';

export type WidgetPreviewAccentStyle = 'risk' | 'commute' | 'city' | 'ticker';

export type WidgetPreviewSize = '2x2' | '4x2' | '4x1';

export type WidgetPreviewSpec = {
  preset: WidgetPreset;
  variant: WidgetPreviewVariant;
  format: WidgetPreviewSize;
  formatLabelKey: 'widgets_picker_format_2x2' | 'widgets_picker_format_4x2' | 'widgets_picker_format_4x1';
  sortOrder: number;
  accentStyle: WidgetPreviewAccentStyle;
  icon: string;
};

export const WIDGET_PREVIEW_SPECS: Record<WidgetPreset, WidgetPreviewSpec> = {
  risk_now: {
    preset: 'risk_now',
    variant: 'risk_now_preview',
    format: '2x2',
    formatLabelKey: 'widgets_picker_format_2x2',
    sortOrder: 1,
    accentStyle: 'risk',
    icon: 'speedometer',
  },
  commute: {
    preset: 'commute',
    variant: 'commute_preview',
    format: '2x2',
    formatLabelKey: 'widgets_picker_format_2x2',
    sortOrder: 2,
    accentStyle: 'commute',
    icon: 'train-car',
  },
  city_pulse: {
    preset: 'city_pulse',
    variant: 'city_pulse_preview',
    format: '4x2',
    formatLabelKey: 'widgets_picker_format_4x2',
    sortOrder: 4,
    accentStyle: 'city',
    icon: 'city-variant-outline',
  },
  alerts_ticker: {
    preset: 'alerts_ticker',
    variant: 'alerts_ticker_preview',
    format: '4x1',
    formatLabelKey: 'widgets_picker_format_4x1',
    sortOrder: 3,
    accentStyle: 'ticker',
    icon: 'alert-outline',
  },
};
