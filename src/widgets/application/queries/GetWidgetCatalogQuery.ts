import i18n from '../../../i18n';
import { WidgetPreset, WIDGET_PRESETS } from '../../domain/WidgetPreset';
import {
  WidgetPreviewAccentStyle,
  WidgetPreviewSize,
  WidgetPreviewVariant,
  WIDGET_PREVIEW_SPECS,
} from '../../domain/WidgetPreviewSpec';

export type WidgetCatalogItem = {
  preset: WidgetPreset;
  title: string;
  subtitle: string;
  icon: string;
  previewVariant: WidgetPreviewVariant;
  format: WidgetPreviewSize;
  formatLabel: string;
  sortOrder: number;
  accentStyle: WidgetPreviewAccentStyle;
};

export const GetWidgetCatalogQuery = {
  execute(): WidgetCatalogItem[] {
    return WIDGET_PRESETS.map(preset => {
      const spec = WIDGET_PREVIEW_SPECS[preset];
      return {
        preset,
        title: i18n.t(`widget_preset_${preset}`, { defaultValue: preset }),
        subtitle: i18n.t(`widget_preset_${preset}_subtitle`, {
          defaultValue: i18n.t('widgets_subtitle', {
            defaultValue: 'Choose your lock-screen signal',
          }),
        }),
        icon: spec.icon,
        previewVariant: spec.variant,
        format: spec.format,
        formatLabel: i18n.t(spec.formatLabelKey, {
          defaultValue: spec.format === '2x2' ? '2 x 2' : spec.format === '4x2' ? '4 x 2' : '4 x 1',
        }),
        sortOrder: spec.sortOrder,
        accentStyle: spec.accentStyle,
      };
    }).sort((a, b) => a.sortOrder - b.sortOrder);
  },
};
