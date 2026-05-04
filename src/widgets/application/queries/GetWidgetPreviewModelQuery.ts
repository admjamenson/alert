import i18n from '../../../i18n';
import { OperationalSnapshotState } from '../../../domain/trust/OperationalSnapshot';
import { WidgetConfidence } from '../../domain/WidgetConfidence';
import { WidgetPreset, WIDGET_PRESETS } from '../../domain/WidgetPreset';
import { WidgetStatusBadge, WidgetStatusTone } from '../../domain/WidgetSnapshot';

export type WidgetPreviewModel = {
  preset: WidgetPreset;
  title: string;
  subtitle: string;
  metric: string;
  confidence: WidgetConfidence;
  confidenceLabel: string;
  updatedAtLabel: string;
  chips: string[];
  deeplink: string;
  level: number;
  segmentProfile: number[];
  iconKey: 'risk' | 'commute' | 'city' | 'ticker';
  statusBadge: WidgetStatusBadge;
  readModelState?: OperationalSnapshotState;
};

const buildUpdatedLabel = (updatedAt?: string) => {
  if (!updatedAt) {
    return i18n.t('widget_updated_now', { defaultValue: 'Updated now' });
  }
  const parsed = Date.parse(updatedAt);
  if (!Number.isFinite(parsed)) {
    return i18n.t('widget_updated_now', { defaultValue: 'Updated now' });
  }

  const deltaMin = Math.max(1, Math.floor((Date.now() - parsed) / 60_000));
  if (deltaMin <= 1) {
    return i18n.t('widget_updated_now', { defaultValue: 'Updated now' });
  }
  if (deltaMin < 60) {
    return i18n.t('widget_updated_minutes_ago', {
      count: deltaMin,
      defaultValue: `Updated ${deltaMin} min ago`,
    });
  }
  return i18n.t('widget_updated_at_label', {
    value: new Intl.DateTimeFormat(i18n.language || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsed)),
    defaultValue: `Updated ${new Intl.DateTimeFormat(i18n.language || undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(parsed))}`,
  });
};

const confidenceLabel = (confidence: WidgetConfidence) =>
  i18n.t(`widget_confidence_${confidence.toLowerCase()}`, {
    defaultValue:
      confidence === 'HIGH' ? 'High confidence' : confidence === 'MEDIUM' ? 'Medium confidence' : 'Low confidence',
  });

const canonicalPresetTitle = (preset: WidgetPreset) =>
  i18n.t(`widget_preset_${preset}`, { defaultValue: preset });

const statusLabelForTone = (tone: WidgetStatusTone) =>
  i18n.t(`widget_alerts_status_${tone === 'moderate' ? 'moderate' : tone}`, {
    defaultValue:
      tone === 'high'
        ? 'Avoid the area'
        : tone === 'moderate'
          ? 'Risk nearby'
          : tone === 'attention'
            ? 'Attention nearby'
            : 'No alerts',
  });

const previewSampleModel = (preset: WidgetPreset): WidgetPreviewModel => {
  const updatedAt = new Date().toISOString();
  const confidence: WidgetConfidence = 'MEDIUM';
  const title = canonicalPresetTitle(preset);

  if (preset === 'commute') {
    return {
      preset,
      title,
      subtitle: i18n.t('widget_destination_default', { defaultValue: 'Work' }),
      metric: '9m',
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      updatedAtLabel: buildUpdatedLabel(updatedAt),
      chips: [statusLabelForTone('normal')],
      deeplink: 'alertapp://route-settings',
      level: 18,
      segmentProfile: [28, 38, 46, 38, 30],
      statusBadge: {
        tone: 'normal',
        label: statusLabelForTone('normal'),
      },
      readModelState: 'fresh',
      iconKey: 'commute',
    };
  }

  if (preset === 'city_pulse') {
    return {
      preset,
      title,
      subtitle: statusLabelForTone('attention'),
      metric: '18',
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      updatedAtLabel: buildUpdatedLabel(updatedAt),
      chips: [statusLabelForTone('attention')],
      deeplink: 'alertapp://monitoring',
      level: 18,
      segmentProfile: [32, 48, 58, 48, 34],
      statusBadge: {
        tone: 'attention',
        label: statusLabelForTone('attention'),
      },
      readModelState: 'fresh',
      iconKey: 'city',
    };
  }

  if (preset === 'alerts_ticker') {
    return {
      preset,
      title,
      subtitle: i18n.t('widget_alerts_focus_local_attention', {
        defaultValue: 'Local caution',
      }),
      metric: '18',
      confidence,
      confidenceLabel: confidenceLabel(confidence),
      updatedAtLabel: buildUpdatedLabel(updatedAt),
      chips: [],
      deeplink: 'alertapp://notifications',
      level: 18,
      segmentProfile: [30, 40, 48, 38, 30],
      statusBadge: {
        tone: 'attention',
        label: statusLabelForTone('attention'),
      },
      readModelState: 'fresh',
      iconKey: 'ticker',
    };
  }

  return {
    preset,
    title,
    subtitle: '',
    metric: '18',
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    updatedAtLabel: buildUpdatedLabel(updatedAt),
    chips: [statusLabelForTone('attention')],
    deeplink: 'alertapp://monitoring',
    level: 18,
    segmentProfile: [26, 32, 38, 34, 28],
    statusBadge: {
      tone: 'attention',
      label: statusLabelForTone('attention'),
    },
    readModelState: 'fresh',
    iconKey: 'risk',
  };
};

export const GetWidgetPreviewModelQuery = {
  async executeAll(): Promise<Record<WidgetPreset, WidgetPreviewModel>> {
    const out = {} as Record<WidgetPreset, WidgetPreviewModel>;
    WIDGET_PRESETS.forEach(preset => {
      out[preset] = previewSampleModel(preset);
    });
    return out;
  },
};
