import { WidgetPreset } from './WidgetPreset';
import { WidgetConfidence } from './WidgetConfidence';

export type WidgetStatusTone = 'positive' | 'neutral' | 'warning' | 'critical' | string;

export type WidgetStatusBadge = {
  label: string;
  tone: WidgetStatusTone;
};

export type WidgetMeterTier = 'low' | 'medium' | 'high' | 'critical' | string;

export type WidgetSnapshot = {
  preset: WidgetPreset;
  updatedAt: string;
  deeplink: string;
  title: string;
  subtitle: string;
  confidence: WidgetConfidence;
  statusBadge?: WidgetStatusBadge;
  visual?: {
    level?: number;
    segmentProfile?: number[];
    meterTier?: WidgetMeterTier;
    iconKey?: string;
  };
  data?: Record<string, any>;
  [key: string]: any;
};
