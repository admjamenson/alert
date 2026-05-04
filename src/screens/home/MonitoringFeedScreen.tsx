import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  AppState,
  AppStateStatus,
  Alert,
  Dimensions,
  FlatList,
  Image,
  I18nManager,
  Linking,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapLibreGL from '@maplibre/maplibre-react-native';
import ViewShot from 'react-native-view-shot';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { getLocales } from 'react-native-localize';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../../context/ThemeContext';
import { useSecurity } from '../../context/SecurityContext';
import { MONITORING_EVENTS } from '../../constants/MonitoringEvents';
import { ThemeTokens } from '../../constants/ThemeTokens';
import {
  HAS_CONFIGURED_SATELLITE_STYLE,
  MAP_STYLE_DEFAULT,
  MAP_STYLE_SAFE_FALLBACK,
  MAP_STYLE_SATELLITE,
  MapStyleMode,
} from '../../constants/MapStyles';
import {
  formatTime,
  formatUpdatedAtDisplay,
  normalizeToIsoDateTime,
  resolveLocale,
  resolveTimeZone,
} from '../../utils/dateTimeFormat';
import { GetDefaultRouteDestinationQuery } from '../../application/queries/GetDefaultRouteDestinationQuery';
import { GetMonitoringFeedScopedSourcesQuery } from '../../application/queries/GetMonitoringFeedScopedSourcesQuery';
import { GetMonitoringFeedContinuitySnapshotQuery } from '../../application/queries/GetMonitoringFeedContinuitySnapshotQuery';
import { GetMonitoringFeedSignalsQuery } from '../../application/queries/GetMonitoringFeedSignalsQuery';
import type { EpidemicSnapshot } from '../../services/EpidemicService';
import type { HealthTopItem } from '../../services/EventHubService';
import type { RiskReport } from '../../services/RiskReportService';
import { TelemetryService } from '../../services/TelemetryService';
import { AlertNotification } from '../../types/notifications';
import { AlertSignal } from '../../types/alertIntelligence';
import { PermissionManager } from '../../utils/permissions';
import HazardSymbolIcon from '../../components/map/HazardSymbolIcon';
import {
  extractAlertCoordinate,
  isWithinRadiusKm,
  mapAlertToCategory,
} from '../../services/importantAlertUtils';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';
import { APP_CONFIG } from '../../core/config';
import type { RootStackParamList } from '../../navigation/types';
import MonitoringInfoOverlay, {
  MonitoringOverlaySource,
  MonitoringOverlayTrustStatus,
} from '../../components/monitoring/MonitoringInfoOverlay';

type FeedScope = 'CITY' | 'STATE' | 'COUNTRY';
type FeedItem = { id: string; type: string; icon: string; titleKey: string };
type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
};
type FeatureCollection = { type: 'FeatureCollection'; features: PointFeature[] };
type PolygonFeature = {
  type: 'Feature';
  geometry: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };
  properties: Record<string, unknown>;
};
type PolygonFeatureCollection = { type: 'FeatureCollection'; features: PolygonFeature[] };
type ShapeSourceShape = React.ComponentProps<typeof MapLibreGL.ShapeSource>['shape'];
type FillLayerStyle = NonNullable<React.ComponentProps<typeof MapLibreGL.FillLayer>['style']>;
type LineLayerStyle = NonNullable<React.ComponentProps<typeof MapLibreGL.LineLayer>['style']>;
type CircleLayerStyle = NonNullable<React.ComponentProps<typeof MapLibreGL.CircleLayer>['style']>;
type ViewShotCaptureRef = React.ElementRef<typeof ViewShot> & {
  capture?: (options?: Record<string, unknown>) => Promise<string | undefined>;
};
type MonitoringCoordinate = { latitude: number; longitude: number };
type MonitoringMapStyle = string | Record<string, unknown>;
type TranslationFn = (key: string, options?: Record<string, unknown>) => string;
type FeedMapPageProps = {
  item: FeedItem;
  index: number;
  total: number;
  active: boolean;
  locale: string;
  timeZone: string;
  userLocation: MonitoringCoordinate | null;
  targetLocation: MonitoringCoordinate | null;
  reducedMotion: boolean;
  initialScope?: FeedScope;
  initialCenter?: MonitoringCoordinate | null;
  initialZoom?: number | null;
  baseMapMode: MapStyleMode;
  canUseSatellite: boolean;
  onToggleBaseMapMode: () => void;
  alertAiEnabled: boolean;
  screenFocused: boolean;
  colors: { primary: string; background: string };
  t: TranslationFn;
  onBack: () => void;
};
type MonitoringFeedScreenProps = NativeStackScreenProps<RootStackParamList, 'MonitoringFeed'>;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const FEED_PAGE_SIZE = 10;
const SOS_RADIUS_KM = 5;
const MONITORING_MAP_STYLE_STORAGE_KEY = '@Alert:MonitoringMapBaseMode';
const RAIL_OVERLAY_OFFSET = 120;
const WATERMARK_LOGO = require('../../assets/logo.png');
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] };
const EMPTY_POLYGON_FC: PolygonFeatureCollection = { type: 'FeatureCollection', features: [] };
const toShapeSourceShape = (shape: FeatureCollection | PolygonFeatureCollection): ShapeSourceShape =>
  shape as unknown as ShapeSourceShape;
const fillLayerStyle = (style: Record<string, unknown>): FillLayerStyle =>
  style as unknown as FillLayerStyle;
const lineLayerStyle = (style: Record<string, unknown>): LineLayerStyle =>
  style as unknown as LineLayerStyle;
const circleLayerStyle = (style: Record<string, unknown>): CircleLayerStyle =>
  style as unknown as CircleLayerStyle;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const coordinatePairFromUnknown = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const longitude = Number(value[0]);
  const latitude = Number(value[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
  return [longitude, latitude];
};
const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;
const SCOPE_ZOOM: Record<FeedScope, number> = { CITY: 13.5, STATE: 8, COUNTRY: 5 };
const WIND_PANEL_CARD_WIDTH = 230;
const PANDEMIC_CARD_WIDTH = 232;
const WIND_PANEL_PAGE_WIDTH = WIND_PANEL_CARD_WIDTH + 8;
const PANDEMIC_PAGE_WIDTH = PANDEMIC_CARD_WIDTH + 8;
const AREA_RADIUS_BY_SCOPE_KM: Record<FeedScope, number> = {
  CITY: 3.5,
  STATE: 14,
  COUNTRY: 38,
};
const AREA_RADIUS_EPIDEMIC_BY_SCOPE_KM: Record<FeedScope, number> = {
  CITY: 6,
  STATE: 18,
  COUNTRY: 46,
};
const SOS_AREA_RADIUS_BY_SCOPE_KM: Record<FeedScope, number> = {
  CITY: 1.8,
  STATE: 3.2,
  COUNTRY: 5.6,
};
const AREA_FILL_OPACITY_BY_SCOPE: Record<FeedScope, number> = {
  CITY: 0.24,
  STATE: 0.19,
  COUNTRY: 0.15,
};
const SOURCE_LEVEL_BY_SCOPE: Record<FeedScope, 'MUNICIPAL' | 'STATE' | 'COUNTRY'> = {
  CITY: 'MUNICIPAL',
  STATE: 'STATE',
  COUNTRY: 'COUNTRY',
};
const CRITICAL_REFRESH_EVENT_TYPES = new Set([
  'earthquake',
  'flood',
  'storm',
  'lightning',
  'cyclone',
  'tornado',
  'hurricane',
  'landslide',
  'wildfire',
  'tsunami',
]);

const toPadded = (value: number) => String(value).padStart(2, '0');
const sanitizeFileSegment = (value: string) =>
  String(value || 'monitoring')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'monitoring';
const buildScreenshotFileName = (type: string) => {
  const now = new Date();
  const timestamp = `${now.getFullYear()}${toPadded(now.getMonth() + 1)}${toPadded(now.getDate())}_${toPadded(now.getHours())}${toPadded(now.getMinutes())}${toPadded(now.getSeconds())}`;
  return `Alert_${sanitizeFileSegment(type)}_${timestamp}`;
};

const distanceMeters = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
};

const isEpidemicType = (type: string) => type === 'pandemic' || type === 'epidemic';
const toEpidemicMode = (type: string): 'pandemic' | 'epidemic' =>
  type === 'pandemic' ? 'pandemic' : 'epidemic';
const isWindMainType = (type: string) => type === 'wind';
const WIND_ALERT_TYPES = new Set(['wind', 'gale', 'wind_gust_10', 'wind_gust_50']);

const trendLabelFromValue = (trend: string, t: TranslationFn) => {
  const normalized = String(trend || '').toLowerCase();
  if (normalized === 'up') {
    return t('monitoring_feed_pandemic_trend_up', { defaultValue: 'Em alta' });
  }
  if (normalized === 'down') {
    return t('monitoring_feed_pandemic_trend_down', { defaultValue: 'Em queda' });
  }
  return t('monitoring_feed_pandemic_trend_flat', { defaultValue: 'Estavel' });
};

const buildCatalog = (priorityTypes?: string[]): FeedItem[] => {
  const fallbackPriority = ['pandemic', 'epidemic'];
  const validEventIds = new Set(MONITORING_EVENTS.map(item => item.id));
  const normalizedPriority = Array.isArray(priorityTypes)
    ? Array.from(
        new Set(
          priorityTypes
            .map(item => String(item || '').trim().toLowerCase())
            .filter(item => item.length > 0 && item !== 'sos_nearby' && validEventIds.has(item)),
        ),
      )
    : [];
  const orderedPriority =
    normalizedPriority.length > 0 ? normalizedPriority : fallbackPriority;
  const prioritySet = new Set(orderedPriority);
  const prioritized = orderedPriority
    .map(id => MONITORING_EVENTS.find(item => item.id === id))
    .filter((item): item is (typeof MONITORING_EVENTS)[number] => Boolean(item));
  const remaining = MONITORING_EVENTS.filter(item => !prioritySet.has(item.id));
  const base = [
    {
      id: 'feed-sos-nearby',
      type: 'sos_nearby',
      icon: 'shield-alert',
      titleKey: 'monitoring_feed_sos_nearby',
    },
  ];
  const rest = [...prioritized, ...remaining].map(item => ({
    id: `feed-${item.id}`,
    type: item.id,
    icon: item.icon,
    titleKey: `monitoring_event_${item.id}`,
  }));
  return [...base, ...rest];
};

const withAlpha = (hex: string, alpha: number): string => {
  if (!hex?.startsWith?.('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, alpha))})`;
};

const getCenterFromPayload = (payload: unknown): [number, number] | null => {
  if (!isRecord(payload)) return null;
  const geometry = isRecord(payload.geometry) ? payload.geometry : null;
  const properties = isRecord(payload.properties) ? payload.properties : null;
  return (
    coordinatePairFromUnknown(geometry?.coordinates) ||
    coordinatePairFromUnknown(properties?.center) ||
    coordinatePairFromUnknown(payload.centerCoordinate)
  );
};

const getZoomFromPayload = (payload: unknown): number | null => {
  if (!isRecord(payload)) return null;
  const properties = isRecord(payload.properties) ? payload.properties : null;
  const zoom = Number(properties?.zoomLevel ?? payload.zoomLevel ?? payload.zoom);
  return Number.isFinite(zoom) ? zoom : null;
};

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map(v => String(v || '').trim()).filter(Boolean)));

const dedupeOverlaySources = (sources: MonitoringOverlaySource[]): MonitoringOverlaySource[] => {
  const map = new Map<string, MonitoringOverlaySource>();
  sources.forEach(source => {
    const name = String(source?.name || '').trim();
    if (!name) return;
    const key = `${name.toLowerCase()}|${String(source.url || '').trim().toLowerCase()}`;
    if (!map.has(key)) {
      map.set(key, {
        name,
        url: source.url,
        officiality: source.officiality,
      });
    }
  });
  return Array.from(map.values());
};

const normalizeOverlaySourcesFromNames = (names: string[], url?: string): MonitoringOverlaySource[] =>
  dedupeOverlaySources(
    names
      .map(name => sanitizeFeedText(name))
      .filter(Boolean)
      .slice(0, 3)
      .map(name => ({
        name,
        url,
        officiality: 'REFERENCE',
      })),
  );

const deriveTrustStatus = (
  updatedAt: string | undefined,
  status: 'active' | 'none' | 'unavailable' | 'loading',
): MonitoringOverlayTrustStatus => {
  if (status === 'loading' || status === 'unavailable') return 'unavailable';
  const parsedMs = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(parsedMs)) return 'unavailable';
  const ageMs = Math.max(0, Date.now() - parsedMs);
  if (ageMs <= 60 * 60 * 1000) return 'online';
  if (ageMs <= 4 * 60 * 60 * 1000) return 'stale';
  return 'offline';
};

const hasOfficialSource = (sources: MonitoringOverlaySource[]): boolean =>
  sources.some(source => source.officiality === 'OFFICIAL');

const mapAiSourceToOverlayOfficiality = (
  source: {
    officiality?: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' | string;
    sourceClass?:
      | 'OFFICIAL'
      | 'TRUSTED_MEDIA'
      | 'TRUSTED_SOCIAL'
      | 'COMMUNITY'
      | 'ESTIMATED'
      | string;
  },
): MonitoringOverlaySource['officiality'] => {
  if (source.sourceClass === 'OFFICIAL') return 'OFFICIAL';
  if (source.sourceClass === 'TRUSTED_MEDIA') return 'TRUSTED_MEDIA';
  if (source.sourceClass === 'TRUSTED_SOCIAL') return 'TRUSTED_SOCIAL';
  if (source.sourceClass === 'COMMUNITY') return 'COMMUNITY';
  if (source.sourceClass === 'ESTIMATED') return 'ESTIMATED';
  if (source.officiality === 'OFFICIAL') return 'OFFICIAL';
  if (source.officiality === 'VERIFIED') return 'VERIFIED';
  return 'REFERENCE';
};

const formatRelativeAgeLabel = (
  updatedAt: string | undefined,
  t: TranslationFn,
): string => {
  const parsedMs = Date.parse(String(updatedAt || ''));
  if (!Number.isFinite(parsedMs)) {
    return t('monitoring_updated_ago_unknown', { defaultValue: 'agora' });
  }
  const ageMs = Math.max(0, Date.now() - parsedMs);
  const minutes = Math.max(1, Math.floor(ageMs / 60_000));
  if (minutes < 60) {
    return t('monitoring_updated_ago_minutes', {
      count: minutes,
      defaultValue: `${minutes} min`,
    });
  }
  const hours = Math.max(1, Math.floor(minutes / 60));
  if (hours < 24) {
    return t('monitoring_updated_ago_hours', {
      count: hours,
      defaultValue: `${hours} h`,
    });
  }
  const days = Math.max(1, Math.floor(hours / 24));
  return t('monitoring_updated_ago_days', {
    count: days,
    defaultValue: `${days} d`,
  });
};

const parseCountValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[^\d-]/g, '');
  if (!cleaned || cleaned === '-') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
};

const sanitizeFeedText = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return value
    .replace(/â€¢/g, ' | ')
    .replace(/â€“/g, '-')
    .replace(/â€”/g, '-')
    .replace(/Â/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

const buildCasesDeathsSummary = (
  level: { cases?: unknown; deaths?: unknown } | null | undefined,
  locale: string,
  t: TranslationFn,
): string => {
  if (!level) return '';
  const casesValue = parseCountValue(level.cases);
  const deathsValue = parseCountValue(level.deaths);
  const parts: string[] = [];
  if (casesValue !== null) {
    parts.push(
      `${t('epidemic_map_cases_short', { defaultValue: 'Casos' })}: ${casesValue.toLocaleString(locale)}`,
    );
  }
  if (deathsValue !== null) {
    parts.push(
      `${t('epidemic_map_deaths_short', { defaultValue: 'Obitos' })}: ${deathsValue.toLocaleString(locale)}`,
    );
  }
  return parts.join(' | ');
};

const normalizeTrustTier = (value: unknown): 'A' | 'B' | 'C' | '' => {
  const trust = String(value || '')
    .trim()
    .toUpperCase();
  if (trust === 'A' || trust === 'B' || trust === 'C') return trust;
  return '';
};

const buildSourceLabelWithTrust = (
  t: TranslationFn,
  sourceName?: string,
  trustTier?: string,
): string => {
  const normalizedSource = sanitizeFeedText(sourceName);
  if (!normalizedSource) {
    return t('official_sources_load_error', {
      defaultValue: 'Fonte oficial indisponivel',
    });
  }
  const sourceLine = t('epidemic_map_source_prefix', {
    source: normalizedSource,
    defaultValue: `Fonte: ${normalizedSource}`,
  });
  const safeTrust = normalizeTrustTier(trustTier);
  if (!safeTrust) return sourceLine;
  return `${sourceLine} | ${t('official_sources_trust_label', {
    defaultValue: 'Confianca',
  })} ${safeTrust}`;
};

const buildPointsForAlerts = (alerts: AlertNotification[], categoryType: string): FeatureCollection => {
  const features: PointFeature[] = [];
  alerts.forEach(alert => {
    if (categoryType !== 'all' && mapAlertToCategory(alert) !== categoryType) return;
    const coord = extractAlertCoordinate(alert);
    if (!coord) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [coord.longitude, coord.latitude] },
      properties: {
        title: alert.title,
        summary: alert.summary,
        sourceName: alert.sourceName,
        timestamp: alert.timestamp,
      },
    });
  });
  return { type: 'FeatureCollection', features };
};

const buildSosPoints = (
  reports: RiskReport[],
  currentLocation: { latitude: number; longitude: number } | null,
  targetLocation: { latitude: number; longitude: number } | null,
): FeatureCollection => {
  const features: PointFeature[] = [];
  reports.forEach(report => {
    if (report.kind !== 'sos') return;
    const point = { latitude: report.latitude, longitude: report.longitude };
    const nearCurrent = isWithinRadiusKm(point, currentLocation, SOS_RADIUS_KM);
    const nearTarget = isWithinRadiusKm(point, targetLocation, SOS_RADIUS_KM);
    if (!nearCurrent && !nearTarget) return;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] },
      properties: { severity: report.severity, timestamp: report.timestamp, source: report.source },
    });
  });
  return { type: 'FeatureCollection', features };
};

const buildSinglePointCollection = (
  coordinate: { latitude: number; longitude: number } | null,
  properties: Record<string, unknown> = {},
): FeatureCollection => {
  if (!coordinate) return EMPTY_FC;
  if (!Number.isFinite(coordinate.latitude) || !Number.isFinite(coordinate.longitude)) {
    return EMPTY_FC;
  }
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [coordinate.longitude, coordinate.latitude],
        },
        properties,
      },
    ],
  };
};

const buildCirclePolygon = (
  longitude: number,
  latitude: number,
  radiusKm: number,
  steps = 28,
): Array<[number, number]> => {
  const safeSteps = Math.max(16, steps);
  const latRadius = radiusKm / 110.574;
  const cosLat = Math.cos((latitude * Math.PI) / 180);
  const lonRadius = radiusKm / (111.320 * Math.max(0.2, Math.abs(cosLat)));
  const ring: Array<[number, number]> = [];

  for (let i = 0; i <= safeSteps; i += 1) {
    const theta = (2 * Math.PI * i) / safeSteps;
    const lng = longitude + lonRadius * Math.cos(theta);
    const lat = latitude + latRadius * Math.sin(theta);
    ring.push([lng, lat]);
  }

  return ring;
};

const buildAreaPolygonsFromPoints = (
  points: FeatureCollection,
  radiusKm: number,
  maxFeatures = 16,
): PolygonFeatureCollection => {
  if (!Array.isArray(points.features) || points.features.length === 0) return EMPTY_POLYGON_FC;
  const radius = Math.max(0.6, radiusKm);
  const features: PolygonFeature[] = points.features.slice(0, maxFeatures).flatMap(feature => {
    const coordinates = feature?.geometry?.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const longitude = Number(coordinates[0]);
    const latitude = Number(coordinates[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    return [
      {
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [buildCirclePolygon(longitude, latitude, radius)],
        },
        properties: {
          ...(feature.properties || {}),
          radiusKm: radius,
        },
      },
    ];
  });

  if (features.length === 0) return EMPTY_POLYGON_FC;
  return { type: 'FeatureCollection', features };
};

const buildSignalPoints = (signals: AlertSignal[]): FeatureCollection => {
  const features: PointFeature[] = signals
    .flatMap(signal => {
      if (signal?.geometry?.type !== 'Point') return [];
      const coordinates = signal.geometry.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
      const longitude = Number(coordinates[0]);
      const latitude = Number(coordinates[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
      return [
        {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          properties: {
            id: signal.id,
            category: signal.category,
            severity: signal.severity,
            sourceName: signal.sourceName,
            timestamp: signal.timestamp,
          },
        },
      ];
    });
  return { type: 'FeatureCollection', features };
};

const buildSignalPolygons = (signals: AlertSignal[]): PolygonFeatureCollection => {
  const polygonSignals = signals.filter(
    (
      signal,
    ): signal is AlertSignal & {
      geometry: { type: 'Polygon'; coordinates: Array<Array<[number, number]>> };
    } => signal?.geometry?.type === 'Polygon',
  );
  const features: PolygonFeature[] = polygonSignals
    .flatMap(signal => {
      const coordinates = signal.geometry.coordinates;
      if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
      return [
        {
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates,
          },
          properties: {
            id: signal.id,
            category: signal.category,
            severity: signal.severity,
            sourceName: signal.sourceName,
            timestamp: signal.timestamp,
          },
        },
      ];
    });
  return features.length > 0
    ? { type: 'FeatureCollection', features }
    : EMPTY_POLYGON_FC;
};

const trustStatusFromFreshness = (
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN',
): MonitoringOverlayTrustStatus => {
  if (freshness === 'FRESH') return 'online';
  if (freshness === 'STALE') return 'stale';
  return 'unavailable';
};

const AI_SIGNAL_COLOR = [
  'match',
  ['get', 'severity'],
  'critical',
  '#FF3B30',
  'high',
  '#FF9100',
  'medium',
  '#FFCC00',
  '#4FC3F7',
] as const;

const AI_SIGNAL_RADIUS = [
  'match',
  ['get', 'severity'],
  'critical',
  9,
  'high',
  8,
  'medium',
  7,
  6,
] as const;

const colorForType = (type: string, primary: string) => {
  if (type === 'sos_nearby') return '#FFD600';
  if (type === 'pandemic' || type === 'epidemic') return '#42A5F5';
  if (type.includes('water') || type.includes('flood') || type.includes('tsunami')) return '#4FC3F7';
  if (type.includes('earthquake') || type.includes('landslide')) return '#EF5350';
  if (type.includes('storm') || type.includes('wind') || type.includes('lightning')) return '#AB47BC';
  if (type.includes('energy')) return '#FFD54F';
  return primary;
};

type PageData = {
  loading: boolean;
  status: 'active' | 'none' | 'unavailable' | 'loading';
  trustStatus: MonitoringOverlayTrustStatus;
  continuityMode: 'live' | 'snapshot_verified' | 'monitoring' | 'trusted_signals';
  summary: string;
  aiSummary?: string;
  aiConflict?: boolean;
  evidenceLinks?: string[];
  sourceLine: string;
  sourceTrustTier?: 'A' | 'B' | 'C' | '';
  sourceUrl?: string;
  sources: MonitoringOverlaySource[];
  sourcesFallback: boolean;
  officialLocalMissing?: boolean;
  updatedAt?: string;
  aiSignals: AlertSignal[];
  officialPoints: FeatureCollection;
  sosPoints: FeatureCollection;
  snapshot?: EpidemicSnapshot | null;
  windPanels?: Array<{
    id: string;
    label: string;
    summary: string;
    sourceLine: string;
    sourceTrustTier?: 'A' | 'B' | 'C' | '';
    sourceUrl?: string;
    updatedAt?: string;
    points: FeatureCollection;
    count: number;
  }>;
  pandemicTop3?: HealthTopItem[];
};

const FeedMapPage = ({
  item,
  index,
  total,
  active,
  locale,
  timeZone,
  userLocation,
  targetLocation,
  reducedMotion,
  initialScope,
  initialCenter,
  initialZoom,
  baseMapMode,
  canUseSatellite,
  onToggleBaseMapMode,
  alertAiEnabled,
  screenFocused,
  colors,
  t,
  onBack,
}: FeedMapPageProps) => {
  const { isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<React.ElementRef<typeof MapLibreGL.Camera> | null>(null);
  const mapRef = useRef<React.ElementRef<typeof MapLibreGL.MapView> | null>(null);
  const viewShotRef = useRef<ViewShotCaptureRef | null>(null);
  const windScrollRef = useRef<ScrollView | null>(null);
  const pandemicScrollRef = useRef<ScrollView | null>(null);
  const mountedRef = useRef(true);
  const invalidUpdatedAtTelemetryRef = useRef<string | null>(null);
  const [scope, setScope] = useState<FeedScope>(initialScope || 'CITY');
  const [saving, setSaving] = useState(false);
  const [showRecenter, setShowRecenter] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [windPanelIndex, setWindPanelIndex] = useState(0);
  const [pandemicTopIndex, setPandemicTopIndex] = useState(0);
  const recenterForegroundColor = isDark ? '#FFFFFF' : '#111111';
  const recenterBackgroundColor = isDark ? 'rgba(17,17,17,0.82)' : 'rgba(255,255,255,0.96)';
  const recenterBorderColor = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.12)';
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const [cameraCenter, setCameraCenter] = useState<[number, number] | null>(
    initialCenter ? [initialCenter.longitude, initialCenter.latitude] : null,
  );
  const [cameraZoom, setCameraZoom] = useState<number | null>(initialZoom ?? null);
  const preferredMapStyle = useMemo(
    () =>
      baseMapMode === 'satellite' && canUseSatellite
        ? MAP_STYLE_SATELLITE
        : MAP_STYLE_DEFAULT,
    [baseMapMode, canUseSatellite],
  );
  const [resolvedMapStyle, setResolvedMapStyle] = useState<MonitoringMapStyle>(
    preferredMapStyle as MonitoringMapStyle,
  );
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [data, setData] = useState<PageData>({
    loading: true,
    status: 'loading',
    trustStatus: 'unavailable',
    continuityMode: 'monitoring',
    summary: t('monitoring_loading', { defaultValue: 'Carregando monitoramento...' }),
    aiSummary: '',
    aiConflict: false,
    evidenceLinks: [],
    sourceLine: t('official_sources_loading', { defaultValue: 'Carregando fontes oficiais...' }),
    sourceTrustTier: '',
    sources: [],
    sourcesFallback: false,
    officialLocalMissing: false,
    aiSignals: [],
    officialPoints: EMPTY_FC,
    sosPoints: EMPTY_FC,
    snapshot: null,
    windPanels: undefined,
    pandemicTop3: undefined,
  });

  const hasUser = isFiniteCoordinatePair(userLocation?.latitude, userLocation?.longitude);
  const userLat = hasUser ? Number(userLocation?.latitude) : 0;
  const userLon = hasUser ? Number(userLocation?.longitude) : 0;
  const safeUserLocation = useMemo(
    () => (hasUser ? { latitude: userLat, longitude: userLon } : null),
    [hasUser, userLat, userLon],
  );
  const dotColor = colorForType(item.type, colors.primary);
  const itemTitle = t(item.titleKey);
  const safeInitialScope: FeedScope =
    initialScope === 'STATE' || initialScope === 'COUNTRY' ? initialScope : 'CITY';
  const aiCategory = item.type === 'sos_nearby' ? 'sos' : item.type;
  const autoRefreshMs = useMemo(() => {
    if (item.type === 'sos_nearby') return 20_000;
    if (CRITICAL_REFRESH_EVENT_TYPES.has(item.type)) return 30_000;
    return 90_000;
  }, [item.type]);

  useEffect(() => {
    setResolvedMapStyle(preferredMapStyle);
    setUsingFallbackStyle(false);
    setMapFailed(false);
  }, [preferredMapStyle]);

  useEffect(() => {
    const center = cameraCenter || (hasUser ? [userLon, userLat] : null);
    const zoomLevel = Number.isFinite(cameraZoom as number)
      ? (cameraZoom as number)
      : SCOPE_ZOOM[scope];
    if (!center) return;
    const timeoutId = setTimeout(() => {
      cameraRef.current?.setCamera?.({
        centerCoordinate: center,
        zoomLevel,
        animationDuration: 0,
      });
    }, 60);
    return () => clearTimeout(timeoutId);
  }, [resolvedMapStyle]);

  const applyScope = useCallback(
    (nextScope: FeedScope, animate = true) => {
      if (!safeUserLocation) return;
      setScope(nextScope);
      setIsFollowing(true);
      setShowRecenter(false);
      const center: [number, number] = [safeUserLocation.longitude, safeUserLocation.latitude];
      const zoomLevel = SCOPE_ZOOM[nextScope];
      setCameraCenter(center);
      setCameraZoom(zoomLevel);
      cameraRef.current?.setCamera?.({
        centerCoordinate: center,
        zoomLevel,
        animationMode: 'easeTo',
        animationDuration: animate && !reducedMotion ? 260 : 0,
      });
    },
    [reducedMotion, safeUserLocation],
  );

  const resolveScopedOfficialSources = useCallback(
    async (force = false): Promise<{
      sources: MonitoringOverlaySource[];
      fallbackApplied: boolean;
      freshestAt?: string;
    }> => {
      if (!safeUserLocation) {
        return { sources: [], fallbackApplied: true, freshestAt: undefined };
      }

      try {
        const resolved = await GetMonitoringFeedScopedSourcesQuery.execute({
          latitude: safeUserLocation.latitude,
          longitude: safeUserLocation.longitude,
          locale,
          monitoringType: item.type,
          targetLevel: SOURCE_LEVEL_BY_SCOPE[scope],
          force,
        });
        const sources = dedupeOverlaySources(
          resolved.sources.map(source => ({
            name: sanitizeFeedText(source.name),
            url: source.url,
            officiality: source.officiality,
          })),
        );

        return {
          sources,
          fallbackApplied: resolved.fallbackApplied,
          freshestAt: resolved.freshestAt,
        };
      } catch {
        return { sources: [], fallbackApplied: true, freshestAt: undefined };
      }
    },
    [item.type, locale, safeUserLocation, scope],
  );

  const buildSnapshotVerifiedSummary = useCallback(
    (updatedAt?: string) => {
      const localTime =
        formatTime(updatedAt || '', locale, timeZone, {
          hour: '2-digit',
          minute: '2-digit',
        }) || '--';
      return t('monitoring_continuity_snapshot_verified', {
        defaultValue: `Mostrando última informação verificada • ${localTime}`,
        time: localTime,
      });
    },
    [locale, t, timeZone],
  );

  const restoreContinuitySnapshot = useCallback(async (): Promise<PageData | null> => {
    try {
      const continuity = await GetMonitoringFeedContinuitySnapshotQuery.read({
        eventType: item.type,
        scope,
        latitude: safeUserLocation?.latitude,
        longitude: safeUserLocation?.longitude,
      });
      if (!continuity) return null;
      const snapshot = continuity.snapshot;
      const sources = dedupeOverlaySources(
        (Array.isArray(snapshot.sources) ? snapshot.sources : []).map(source => ({
          name: sanitizeFeedText(source?.name),
          url: source?.url,
          officiality: source?.officiality || 'REFERENCE',
        })),
      ).slice(0, 3);
      const hasOfficialLocal = hasOfficialSource(sources);
      return {
        loading: false,
        status:
          snapshot.status === 'loading' || snapshot.status === 'unavailable'
            ? 'none'
            : snapshot.status,
        trustStatus: continuity.freshness === 'stale' ? 'stale' : snapshot.trustStatus,
        continuityMode: 'snapshot_verified',
        summary: buildSnapshotVerifiedSummary(snapshot.updatedAt),
        aiSummary: snapshot.aiSummary || '',
        aiConflict: Boolean(snapshot.aiConflict),
        evidenceLinks: Array.isArray(snapshot.evidenceLinks) ? snapshot.evidenceLinks : [],
        sourceLine:
          sanitizeFeedText(snapshot.sourceLine) ||
          t('monitoring_continuity_waiting_sources', {
            defaultValue: 'Monitorando fontes confiáveis agora.',
          }),
        sourceTrustTier: snapshot.sourceTrustTier || '',
        sourceUrl: snapshot.sourceUrl,
        sources,
        sourcesFallback: true,
        officialLocalMissing: !hasOfficialLocal,
        updatedAt: snapshot.updatedAt,
        aiSignals: Array.isArray(snapshot.aiSignals) ? snapshot.aiSignals : [],
        officialPoints:
          snapshot.officialPoints?.type === 'FeatureCollection'
            ? (snapshot.officialPoints as FeatureCollection)
            : EMPTY_FC,
        sosPoints:
          snapshot.sosPoints?.type === 'FeatureCollection'
            ? (snapshot.sosPoints as FeatureCollection)
            : EMPTY_FC,
        snapshot: null,
        windPanels: Array.isArray(snapshot.windPanels)
          ? (snapshot.windPanels as PageData['windPanels'])
          : undefined,
        pandemicTop3: Array.isArray(snapshot.pandemicTop3)
          ? (snapshot.pandemicTop3 as HealthTopItem[])
          : undefined,
      };
    } catch {
      return null;
    }
  }, [buildSnapshotVerifiedSummary, item.type, safeUserLocation?.latitude, safeUserLocation?.longitude, scope, t]);

  const persistContinuitySnapshot = useCallback(
    (nextData: PageData) => {
      if (nextData.loading) return;
      const hasSummary = String(nextData.summary || '').trim().length > 0;
      if (!hasSummary) return;
      void GetMonitoringFeedContinuitySnapshotQuery.save({
        eventType: item.type,
        scope,
        latitude: safeUserLocation?.latitude,
        longitude: safeUserLocation?.longitude,
        status: nextData.status,
        trustStatus: nextData.trustStatus,
        summary: nextData.summary,
        aiSummary: nextData.aiSummary,
        aiConflict: nextData.aiConflict,
        evidenceLinks: nextData.evidenceLinks,
        sourceLine: nextData.sourceLine,
        sourceTrustTier: nextData.sourceTrustTier || '',
        sourceUrl: nextData.sourceUrl,
        sources: nextData.sources,
        sourcesFallback: nextData.sourcesFallback,
        updatedAt: nextData.updatedAt,
        aiSignals: nextData.aiSignals || [],
        officialPoints: nextData.officialPoints || EMPTY_FC,
        sosPoints: nextData.sosPoints || EMPTY_FC,
        windPanels: nextData.windPanels,
        pandemicTop3: nextData.pandemicTop3,
      });
    },
    [item.type, safeUserLocation?.latitude, safeUserLocation?.longitude, scope],
  );

  const load = useCallback(
    async (force = false) => {
      if (!safeUserLocation) {
        const continuityFallback = await restoreContinuitySnapshot();
        if (!mountedRef.current) return;
        if (continuityFallback) {
          setData({
            ...continuityFallback,
            loading: false,
            continuityMode: 'snapshot_verified',
            summary: buildSnapshotVerifiedSummary(continuityFallback.updatedAt),
            sourcesFallback: true,
          });
          return;
        }
        setData(prev => ({
          ...prev,
          loading: false,
          status: 'none',
          trustStatus: 'stale',
          continuityMode: 'monitoring',
          summary: t('monitoring_continuity_monitoring_now', {
            defaultValue: 'Monitorando agora',
          }),
          aiSummary: '',
          aiConflict: false,
          evidenceLinks: [],
          sourceLine: t('monitoring_continuity_waiting_sources', {
            defaultValue: 'Monitorando fontes confiáveis agora.',
          }),
          sourceTrustTier: '',
          sources: prev.sources,
          sourcesFallback: true,
          officialLocalMissing: true,
          aiSignals: [],
          officialPoints: prev.officialPoints,
          sosPoints: prev.sosPoints,
        }));
        return;
      }

      if (mountedRef.current) {
        setData(prev => ({
          ...prev,
          loading: !prev.updatedAt || force,
          status: prev.updatedAt && !force ? prev.status : 'loading',
        }));
      }

      try {
        const [signalSnapshot, scopedSources] = await Promise.all([
          GetMonitoringFeedSignalsQuery.execute({
            latitude: safeUserLocation.latitude,
            longitude: safeUserLocation.longitude,
            itemType: item.type,
            locale,
            timeZone,
            scope,
            aiCategory,
            alertAiEnabled,
            force,
          }),
          resolveScopedOfficialSources(force),
        ]);
        const {
          reports,
          monitoring,
          snapshot,
          pandemicTop3,
          aiSignals,
          aiSummary,
          aiTrustMeta,
        } = signalSnapshot;

        if (!mountedRef.current) return;

        const syncCompletedAt = normalizeToIsoDateTime(new Date()) || new Date().toISOString();
        const sosPoints = buildSosPoints(reports, safeUserLocation, targetLocation);
        const aiSignalsNormalized = Array.isArray(aiSignals) ? aiSignals : [];
        const aiOverlaySources = dedupeOverlaySources(
          aiTrustMeta.sources.map(source => ({
            name: sanitizeFeedText(source.name),
            url: source.url,
            officiality: mapAiSourceToOverlayOfficiality(source),
          })),
        );
        const hasAiSignals = aiSignalsNormalized.length > 0;
        const aiSevereCount = aiSignalsNormalized.filter(
          signal => signal.severity === 'high' || signal.severity === 'critical',
        ).length;
        const aiSummaryHeadline = hasAiSignals
          ? aiSevereCount > 0
            ? t('alert_ai_summary_detected_severe', {
                count: aiSevereCount,
                total: aiSignalsNormalized.length,
                defaultValue: aiSummary.headline,
              })
            : t('alert_ai_summary_detected', {
                count: aiSignalsNormalized.length,
                defaultValue: aiSummary.headline,
              })
          : t('alert_ai_summary_no_data', {
              defaultValue: aiSummary.headline,
            });
        const aiUpdatedAt =
          normalizeToIsoDateTime(aiTrustMeta.updatedAt) ||
          (hasAiSignals ? syncCompletedAt : undefined);
        const aiTrustStatus = trustStatusFromFreshness(aiTrustMeta.status);

        if (item.type === 'sos_nearby') {
          const status = sosPoints.features.length > 0 ? 'active' : 'none';
          const fallbackSources = normalizeOverlaySourcesFromNames([
            t('monitoring_feed_sos_source', {
              defaultValue: 'Rede Alert (agregado e anonimizado)',
            }),
          ]);
          const mergedSources = dedupeOverlaySources([
            ...aiOverlaySources,
            ...scopedSources.sources,
            ...fallbackSources,
          ]).slice(0, 3);
          const trustStatus = hasAiSignals
            ? aiTrustStatus
            : deriveTrustStatus(
            scopedSources.freshestAt || syncCompletedAt,
            status,
          );
          const nextData: PageData = {
            loading: false,
            status: hasAiSignals ? 'active' : status,
            trustStatus,
            continuityMode: hasAiSignals ? 'trusted_signals' : 'live',
            summary: hasAiSignals
              ? aiSummaryHeadline
              : sosPoints.features.length > 0
                ? t('monitoring_feed_sos_summary', {
                    defaultValue: '{{count}} SOS em ate 5 km',
                    count: sosPoints.features.length,
                  })
                : t('monitoring_no_alerts', { defaultValue: 'Sem alertas no momento' }),
            aiSummary: aiSummaryHeadline,
            aiConflict: aiTrustMeta.conflict,
            evidenceLinks: aiTrustMeta.evidencePack.evidenceLinks,
            sourceLine: t('monitoring_feed_sos_source', {
              defaultValue: 'Rede Alert (agregado e anonimizado)',
            }),
            sourceTrustTier: '',
            updatedAt: aiUpdatedAt || syncCompletedAt,
            sources: mergedSources,
            sourcesFallback: scopedSources.fallbackApplied,
            officialLocalMissing: !hasOfficialSource(mergedSources),
            aiSignals: aiSignalsNormalized,
            officialPoints: EMPTY_FC,
            sosPoints,
            snapshot: null,
            windPanels: undefined,
            pandemicTop3: undefined,
          };
          setData(nextData);
          persistContinuitySnapshot(nextData);
          return;
        }

        if (snapshot) {
          const level =
            scope === 'COUNTRY' ? snapshot.country : scope === 'STATE' ? snapshot.state : snapshot.municipal;
          const stats = buildCasesDeathsSummary(level, locale, t);
          const source = snapshot.sources?.[0];
          const snapshotSourceName = (snapshot.sources || [])
            .map(entry => sanitizeFeedText(entry?.name))
            .filter(Boolean)
            .slice(0, 3)
            .join(' | ');
          const sourceTrustTier =
            source?.tier === 1 ? 'A' : source?.tier === 2 ? 'B' : source?.tier === 3 ? 'C' : '';
          const normalizedSnapshotUpdatedAt =
            normalizeToIsoDateTime(snapshot.asOf || snapshot.fetchedAt) || syncCompletedAt;
          const fallbackSnapshotMessage = sanitizeFeedText(snapshot.message);
          const snapshotSources = dedupeOverlaySources(
            (snapshot.sources || []).slice(0, 3).map(itemSource => ({
              name: sanitizeFeedText(itemSource?.name),
              url: itemSource?.url,
              officiality:
                itemSource?.tier === 1
                  ? 'OFFICIAL'
                  : itemSource?.tier === 2
                    ? 'TRUSTED_MEDIA'
                    : 'REFERENCE',
            })),
          );
          const mergedSources = dedupeOverlaySources([
            ...aiOverlaySources,
            ...snapshotSources,
            ...scopedSources.sources,
          ]).slice(0, 3);
          const status = stats || fallbackSnapshotMessage ? 'active' : 'none';
          const trustStatus = hasAiSignals
            ? aiTrustStatus
            : deriveTrustStatus(
              scopedSources.freshestAt || normalizedSnapshotUpdatedAt,
              status,
            );
          const nextData: PageData = {
            loading: false,
            status: hasAiSignals ? 'active' : status,
            trustStatus,
            continuityMode: hasAiSignals ? 'trusted_signals' : 'live',
            summary: hasAiSignals
              ? aiSummaryHeadline
              : stats ||
              fallbackSnapshotMessage ||
              t('monitoring_no_alerts', { defaultValue: 'Sem alertas no momento' }),
            aiSummary: aiSummaryHeadline,
            aiConflict: aiTrustMeta.conflict,
            evidenceLinks: aiTrustMeta.evidencePack.evidenceLinks,
            sourceLine: buildSourceLabelWithTrust(t, snapshotSourceName || source?.name, sourceTrustTier),
            sourceTrustTier: sourceTrustTier || '',
            sourceUrl: source?.url,
            updatedAt: aiUpdatedAt || normalizedSnapshotUpdatedAt,
            sources: mergedSources,
            sourcesFallback: scopedSources.fallbackApplied,
            officialLocalMissing: !hasOfficialSource(mergedSources),
            aiSignals: aiSignalsNormalized,
            officialPoints: EMPTY_FC,
            sosPoints,
            snapshot,
            windPanels: undefined,
            pandemicTop3:
              item.type === 'pandemic'
                ? [...pandemicTop3]
                    .sort((a, b) => b.riskScore - a.riskScore || a.rank - b.rank)
                    .slice(0, 3)
                : undefined,
          };
          setData(nextData);
          persistContinuitySnapshot(nextData);
          return;
        }

        const alerts = monitoring?.alerts || [];
        const filtered = alerts.filter(alert => mapAlertToCategory(alert) === item.type);
        const sourceNames = unique(filtered.map(alert => alert.sourceName));

        if (isWindMainType(item.type)) {
          const windRelated = alerts.filter(alert => {
            const category = mapAlertToCategory(alert);
            return WIND_ALERT_TYPES.has(category);
          });
          const windUnavailable = Boolean(
            monitoring?.unavailableIds?.has('wind') ||
              monitoring?.unavailableIds?.has('gale') ||
              monitoring?.unavailableIds?.has('wind_gust_10') ||
              monitoring?.unavailableIds?.has('wind_gust_50'),
          );
          const gust10 = windRelated.filter(
            alert => mapAlertToCategory(alert) === 'wind_gust_10',
          );
          const gust50 = windRelated.filter(
            alert => mapAlertToCategory(alert) === 'wind_gust_50',
          );
          const fallbackWind = windRelated.length > 0 ? windRelated : filtered;
          const panels = [
            {
              id: 'wind-10',
              label: t('monitoring_event_wind_gust_10', {
                defaultValue: 'Rajadas de vento de 10 km/h',
              }),
              alerts: gust10.length > 0 ? gust10 : fallbackWind,
            },
            {
              id: 'wind-50',
              label: t('monitoring_event_wind_gust_50', {
                defaultValue: 'Rajadas de vento de 50 km/h',
              }),
              alerts: gust50.length > 0 ? gust50 : fallbackWind,
            },
          ];

          const windPanels = panels.map(panel => {
            const panelSources = unique(panel.alerts.map(alert => alert.sourceName));
            const panelSourceName = panelSources.slice(0, 3).join(' | ');
            const topAlert = panel.alerts[0];
            const normalizedPanelUpdatedAt = normalizeToIsoDateTime(topAlert?.timestamp);
            const count = panel.alerts.length;
            const summary =
              count > 0
                ? sanitizeFeedText(topAlert?.summary) ||
                  t('monitoring_feed_wind_panel_summary', {
                    defaultValue: '{{label}}: {{count}} alertas',
                    label: panel.label,
                    count,
                  })
                : windUnavailable
                  ? t('monitoring_continuity_monitoring_now', {
                      defaultValue: 'Monitorando agora',
                    })
                  : t('monitoring_no_alerts', { defaultValue: 'Sem alertas no momento' });

            return {
              id: panel.id,
              label: panel.label,
              summary,
              sourceLine: buildSourceLabelWithTrust(
                t,
                panelSourceName || panelSources[0],
                normalizeTrustTier(
                  (topAlert?.data as Record<string, unknown> | undefined)?.trustTier,
                ),
              ),
              sourceTrustTier: normalizeTrustTier(
                (topAlert?.data as Record<string, unknown> | undefined)?.trustTier,
              ),
              sourceUrl: topAlert?.sourceUrl,
              updatedAt: normalizedPanelUpdatedAt || syncCompletedAt,
              points: buildPointsForAlerts(panel.alerts, 'all'),
              count,
            };
          });

          const activePanel = windPanels[0];
          const panelSources = normalizeOverlaySourcesFromNames(
            unique(activePanel?.points.features.map(feature => String(feature?.properties?.sourceName || ''))),
            activePanel?.sourceUrl,
          );
          const mergedSources = dedupeOverlaySources([
            ...aiOverlaySources,
            ...scopedSources.sources,
            ...panelSources,
          ]).slice(0, 3);
          const status = (activePanel?.count || 0) > 0
              ? 'active'
              : 'none';
          const updatedAt = activePanel?.updatedAt || syncCompletedAt;
          const trustStatus = hasAiSignals
            ? aiTrustStatus
            : deriveTrustStatus(scopedSources.freshestAt || updatedAt, status);
          const nextData: PageData = {
            loading: false,
            status: hasAiSignals ? 'active' : status,
            trustStatus,
            continuityMode: hasAiSignals
              ? 'trusted_signals'
              : windUnavailable
                ? 'snapshot_verified'
                : 'live',
            summary: hasAiSignals
              ? aiSummaryHeadline
              : windUnavailable
                ? buildSnapshotVerifiedSummary(activePanel?.updatedAt || syncCompletedAt)
                : activePanel?.summary || t('monitoring_no_alerts', { defaultValue: 'Sem alertas no momento' }),
            aiSummary: aiSummaryHeadline,
            aiConflict: aiTrustMeta.conflict,
            evidenceLinks: aiTrustMeta.evidencePack.evidenceLinks,
            sourceLine: activePanel?.sourceLine || t('official_sources_load_error', { defaultValue: 'Fonte oficial indisponivel' }),
            sourceTrustTier: activePanel?.sourceTrustTier || '',
            sourceUrl: activePanel?.sourceUrl,
            updatedAt: aiUpdatedAt || updatedAt,
            sources: mergedSources,
            sourcesFallback: scopedSources.fallbackApplied,
            officialLocalMissing: windUnavailable || !hasOfficialSource(mergedSources),
            aiSignals: aiSignalsNormalized,
            officialPoints: activePanel?.points || EMPTY_FC,
            sosPoints,
            snapshot: null,
            windPanels,
            pandemicTop3: undefined,
          };
          setData(nextData);
          persistContinuitySnapshot(nextData);
          return;
        }

        const isUnavailable = Boolean(monitoring?.unavailableIds?.has(item.type));
        const normalizedUpdatedAt = normalizeToIsoDateTime(filtered[0]?.timestamp);
        const sourceLineName = sourceNames.slice(0, 3).join(' | ');
        const primaryTrustTier = normalizeTrustTier(
          (filtered[0]?.data as Record<string, unknown> | undefined)?.trustTier,
        );
        const status =
          monitoring?.activeIds.has(item.type) || filtered.length > 0
              ? 'active'
              : 'none';
        const updatedAt = normalizedUpdatedAt || syncCompletedAt;
        const mergedSources = dedupeOverlaySources([
          ...aiOverlaySources,
          ...scopedSources.sources,
          ...normalizeOverlaySourcesFromNames(sourceNames, filtered[0]?.sourceUrl),
        ]).slice(0, 3);
        const trustStatus = hasAiSignals
          ? aiTrustStatus
          : deriveTrustStatus(scopedSources.freshestAt || updatedAt, status);

        const nextData: PageData = {
          loading: false,
          status: hasAiSignals ? 'active' : status,
          trustStatus,
          continuityMode: hasAiSignals
            ? 'trusted_signals'
            : isUnavailable
              ? 'snapshot_verified'
              : 'live',
          summary: hasAiSignals
            ? aiSummaryHeadline
              : monitoring?.activeIds.has(item.type)
                ? sanitizeFeedText(monitoring.summaries[item.type]) ||
                sanitizeFeedText(filtered[0]?.summary) ||
                t('monitoring_alert_active')
              : isUnavailable
                ? buildSnapshotVerifiedSummary(updatedAt)
              : sanitizeFeedText(filtered[0]?.summary) ||
                t('monitoring_no_alerts', { defaultValue: 'Sem alertas no momento' }),
          aiSummary: aiSummaryHeadline,
          aiConflict: aiTrustMeta.conflict,
          evidenceLinks: aiTrustMeta.evidencePack.evidenceLinks,
          sourceLine: buildSourceLabelWithTrust(
            t,
            sourceLineName ||
              (isUnavailable
                ? t('monitoring_continuity_waiting_sources', {
                    defaultValue: 'Monitorando fontes confiáveis agora.',
                  })
                : undefined),
            primaryTrustTier,
          ),
          sourceTrustTier: primaryTrustTier,
          sourceUrl: filtered[0]?.sourceUrl,
          updatedAt: aiUpdatedAt || updatedAt,
          sources: mergedSources,
          sourcesFallback: scopedSources.fallbackApplied,
          officialLocalMissing: isUnavailable || !hasOfficialSource(mergedSources),
          aiSignals: aiSignalsNormalized,
          officialPoints: buildPointsForAlerts(filtered, item.type),
          sosPoints,
          snapshot: null,
          windPanels: undefined,
          pandemicTop3: undefined,
        };
        setData(nextData);
        persistContinuitySnapshot(nextData);
      } catch {
        const continuityFallback = await restoreContinuitySnapshot();
        if (!mountedRef.current) return;
        if (continuityFallback) {
          setData({
            ...continuityFallback,
            loading: false,
            continuityMode: 'snapshot_verified',
            summary: buildSnapshotVerifiedSummary(continuityFallback.updatedAt),
            sourcesFallback: true,
            officialLocalMissing: true,
          });
          return;
        }
        setData(prev => ({
          ...prev,
          loading: false,
          status: 'none',
          trustStatus: 'stale',
          continuityMode: prev.updatedAt ? 'snapshot_verified' : 'monitoring',
          summary: prev.updatedAt
            ? buildSnapshotVerifiedSummary(prev.updatedAt)
            : t('monitoring_continuity_monitoring_now', {
                defaultValue: 'Monitorando agora',
              }),
          aiSummary: prev.aiSummary || '',
          aiConflict: false,
          evidenceLinks: prev.evidenceLinks || [],
          sourceLine:
            prev.sourceLine ||
            t('monitoring_continuity_waiting_sources', {
              defaultValue: 'Monitorando fontes confiáveis agora.',
            }),
          sourceTrustTier: prev.sourceTrustTier || '',
          sources: prev.sources,
          sourcesFallback: true,
          officialLocalMissing: true,
          aiSignals: prev.aiSignals || [],
          updatedAt:
            normalizeToIsoDateTime(prev.updatedAt) ||
            (typeof prev.updatedAt === 'string' ? prev.updatedAt : undefined),
          windPanels: prev.windPanels,
          pandemicTop3: prev.pandemicTop3,
        }));
      }
    },
    [
      aiCategory,
      alertAiEnabled,
      buildSnapshotVerifiedSummary,
      item.type,
      locale,
      persistContinuitySnapshot,
      resolveScopedOfficialSources,
      restoreContinuitySnapshot,
      safeUserLocation,
      scope,
      t,
      targetLocation,
      timeZone,
    ],
  );

  useEffect(() => {
    mountedRef.current = true;
    setWindPanelIndex(0);
    setPandemicTopIndex(0);
    void load(true);
    if (initialCenter || initialZoom) {
      setTimeout(() => {
        if (!mountedRef.current) return;
        if (hasUser || initialCenter) {
          cameraRef.current?.setCamera?.({
            centerCoordinate: initialCenter
              ? [initialCenter.longitude, initialCenter.latitude]
              : [userLon, userLat],
            zoomLevel: initialZoom ?? SCOPE_ZOOM[safeInitialScope],
            animationDuration: 0,
          });
        }
      }, 0);
    } else {
      applyScope(safeInitialScope, false);
    }
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    if (!active || !safeUserLocation) return;
    void load(false);
  }, [active, load, safeUserLocation]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', nextState => {
      setAppState(nextState);
    });
    return () => {
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (!active || !screenFocused || appState !== 'active') return;
    const id = setInterval(() => void load(false), autoRefreshMs);
    return () => clearInterval(id);
  }, [active, appState, autoRefreshMs, load, screenFocused]);

  useEffect(() => {
    if (!active || !screenFocused || appState !== 'active') return;
    void load(false);
  }, [active, appState, load, screenFocused]);

  useEffect(() => {
    if (!isFollowing || !hasUser) return;
    const center: [number, number] = [userLon, userLat];
    setCameraCenter(center);
  }, [hasUser, isFollowing, userLat, userLon]);

  const onRegionDidChange = useCallback((payload: unknown) => {
    const center = getCenterFromPayload(payload);
    if (center) {
      setCameraCenter(center);
      if (hasUser) {
        const dist = distanceMeters(
          { lat: userLat, lon: userLon },
          { lat: center[1], lon: center[0] },
        );
        const shouldShow = dist > 60;
        if (shouldShow !== showRecenter) {
          setShowRecenter(shouldShow);
        }
        if (shouldShow && isFollowing) {
          setIsFollowing(false);
        }
      }
    }
    const zoom = getZoomFromPayload(payload);
    if (zoom !== null) setCameraZoom(zoom);
  }, [hasUser, isFollowing, showRecenter, userLat, userLon]);

  const handleMapDidFinishLoading = useCallback(() => {
    setMapFailed(false);
  }, []);

  const handleMapDidFailLoading = useCallback(() => {
    TelemetryService.trackEvent('monitoring_feed_map_load_failed', {
      type: item.type,
      baseMapMode,
      usingFallbackStyle,
      canUseSatellite,
    });
    if (!usingFallbackStyle) {
      setUsingFallbackStyle(true);
      setResolvedMapStyle(MAP_STYLE_SAFE_FALLBACK);
      return;
    }
    setMapFailed(true);
  }, [baseMapMode, canUseSatellite, item.type, usingFallbackStyle]);

  const handleRecenter = useCallback(() => {
    if (!hasUser) return;
    const center: [number, number] = [userLon, userLat];
    setIsFollowing(true);
    setShowRecenter(false);
    setCameraCenter(center);
    setCameraZoom(SCOPE_ZOOM[scope]);
    cameraRef.current?.setCamera?.({
      centerCoordinate: center,
      zoomLevel: SCOPE_ZOOM[scope],
      animationMode: 'easeTo',
      animationDuration: 320,
    });
  }, [hasUser, scope, userLat, userLon]);

  const announceAccessibility = useCallback((message: string) => {
    try {
      AccessibilityInfo.announceForAccessibility(message);
    } catch {
      // no-op
    }
  }, []);

  const handleShare = useCallback(async () => {
    const center = cameraCenter || (hasUser ? [userLon, userLat] : null);
    if (!center) return;
    const lat = Math.round(center[1] * 10000) / 10000;
    const lon = Math.round(center[0] * 10000) / 10000;
    const zoom = Number.isFinite(cameraZoom as number) ? Number((cameraZoom as number).toFixed(1)) : SCOPE_ZOOM[scope];
    const type = encodeURIComponent(item.type);
    const scopeParam = encodeURIComponent(scope);
    const appLink = `alertapp://monitoring?type=${type}&scope=${scopeParam}&lat=${lat}&lon=${lon}&zoom=${zoom}`;
    const webLink = `https://alert.app/m?type=${type}&scope=${scopeParam}&lat=${lat}&lon=${lon}&zoom=${zoom}`;
    const storeLink =
      Platform.OS === 'ios'
        ? 'https://apps.apple.com/us/search?term=Alert%20app'
        : 'https://play.google.com/store/apps/details?id=com.alert';
    await Share.share({
      message: `${t('monitoring_feed_share_message', { defaultValue: 'Monitoramento do Alert' })}\n${webLink}\n${appLink}\n${storeLink}`,
      url: appLink,
    }).catch(() => {});
  }, [cameraCenter, cameraZoom, hasUser, item.type, scope, t, userLat, userLon]);

  const handleSave = useCallback(async () => {
    if (saving) return;

    const permissionStatus = await PermissionManager.requestStoragePermission();
    if (permissionStatus !== 'granted') {
      const permissionMessage = t('monitoring_feed_save_permission_error', {
        defaultValue: 'Permita acesso a Fotos/Galeria para salvar.',
      });

      if (permissionStatus === 'blocked') {
        Alert.alert(
          t('auth_permission_required_title', { defaultValue: 'Permissao necessaria' }),
          permissionMessage,
          [
            {
              text: t('common_cancel', { defaultValue: 'Cancelar' }),
              style: 'cancel',
            },
            {
              text: t('common_open_settings', { defaultValue: 'Abrir ajustes' }),
              onPress: () => PermissionManager.openSettings(),
            },
          ],
        );
      } else {
        Alert.alert(permissionMessage);
      }
      announceAccessibility(permissionMessage);
      return;
    }

    setSaving(true);
    announceAccessibility(
      t('monitoring_feed_save_in_progress', { defaultValue: 'Salvando print...' }),
    );

    try {
      const uri = await viewShotRef.current?.capture?.({
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        fileName: buildScreenshotFileName(item.type),
        snapshotContentContainer: false,
        handleGLSurfaceViewOnAndroid: true,
      });
      if (typeof uri === 'string' && uri) {
        await CameraRoll.save(uri, { type: 'photo' });
        const savedAt = formatUpdatedAtDisplay(new Date().toISOString(), locale, timeZone) || '--';
        const successMessage = t('monitoring_feed_save_success_with_time', {
          defaultValue: 'Print salvo na galeria as {{time}}.',
          time: savedAt,
        });
        Alert.alert(successMessage);
        announceAccessibility(successMessage);
        return;
      }
      throw new Error('snapshot');
    } catch {
      const errorMessage = t('monitoring_feed_save_error', {
        defaultValue: 'Nao foi possivel salvar o print agora.',
      });
      Alert.alert(t('common_try_again'), errorMessage);
      announceAccessibility(errorMessage);
    } finally {
      if (mountedRef.current) {
        setSaving(false);
      }
    }
  }, [announceAccessibility, item.type, locale, saving, t, timeZone]);

  const openSource = useCallback((overlaySource?: MonitoringOverlaySource) => {
    const panelSource =
      isWindMainType(item.type) && Array.isArray(data.windPanels) && data.windPanels.length > 0
        ? data.windPanels[Math.max(0, Math.min(windPanelIndex, data.windPanels.length - 1))]
            ?.sourceUrl
        : null;
    const sourceUrl = overlaySource?.url || panelSource || data.sourceUrl;
    if (!sourceUrl) return;
    void Linking.openURL(sourceUrl).catch(() => {});
  }, [data.sourceUrl, data.windPanels, item.type, windPanelIndex]);

  const scopeBtn = (label: string, icon: string, value: FeedScope) => {
    const activeScope = scope === value;
    return (
      <TouchableOpacity
        key={value}
        style={[
          styles.railBtn,
          {
            backgroundColor: activeScope ? colors.primary : 'rgba(0,0,0,0.58)',
            borderColor: activeScope ? withAlpha(colors.primary, 0.9) : 'rgba(255,255,255,0.16)',
          },
        ]}
        onPress={() => applyScope(value, true)}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={t('monitoring_feed_scope_hint')}
        accessibilityState={{ selected: activeScope }}
        activeOpacity={0.88}
        hitSlop={ThemeTokens.Monitoring.railHitSlop}
      >
        <Icon name={icon} size={18} color="#FFF" />
        <Text
          style={styles.railBtnText}
          numberOfLines={2}
          ellipsizeMode="tail"
          adjustsFontSizeToFit
          minimumFontScale={0.78}
          allowFontScaling
          maxFontSizeMultiplier={ThemeTokens.Monitoring.railLabelMaxFontScale}
        >
          {label}
        </Text>
      </TouchableOpacity>
    );
  };

  useEffect(() => {
    if (!isEpidemicType(item.type) || !data.snapshot) return;
    const level =
      scope === 'COUNTRY'
        ? data.snapshot.country
        : scope === 'STATE'
          ? data.snapshot.state
          : data.snapshot.municipal;
    const stats = buildCasesDeathsSummary(level, locale, t);
    if (!stats || stats === data.summary) return;
    setData(prev => ({ ...prev, summary: stats }));
  }, [data.snapshot, data.summary, item.type, locale, scope, t]);

  const activeWindPanel = useMemo(() => {
    if (!isWindMainType(item.type)) return null;
    if (!Array.isArray(data.windPanels) || data.windPanels.length === 0) return null;
    const boundedIndex = Math.max(0, Math.min(windPanelIndex, data.windPanels.length - 1));
    return data.windPanels[boundedIndex];
  }, [data.windPanels, item.type, windPanelIndex]);

  const effectiveSummary = activeWindPanel?.summary || data.summary;
  const effectiveUpdatedAt = activeWindPanel?.updatedAt || data.updatedAt;
  const effectiveOfficialPoints = activeWindPanel?.points || data.officialPoints;
  const effectiveSources = useMemo(() => {
    if (!activeWindPanel) return data.sources;
    const activePanelSourceNames = unique(
      activeWindPanel.points.features.map(feature =>
        String(feature?.properties?.sourceName || ''),
      ),
    );
    return dedupeOverlaySources([
      ...data.sources,
      ...normalizeOverlaySourcesFromNames(activePanelSourceNames, activeWindPanel.sourceUrl),
    ]).slice(0, 3);
  }, [activeWindPanel, data.sources]);
  const evidenceFallbackUrl = data.evidenceLinks?.find(link => String(link || '').trim().length > 0);
  const canOpenEvidence =
    Boolean(evidenceFallbackUrl) || effectiveSources.some(source => Boolean(source.url));
  const handleViewEvidence = useCallback(() => {
    const candidate = effectiveSources.find(source => Boolean(source.url));
    if (candidate) {
      openSource(candidate);
      return;
    }
    if (evidenceFallbackUrl) {
      void Linking.openURL(evidenceFallbackUrl).catch(() => {});
    }
  }, [effectiveSources, evidenceFallbackUrl, openSource]);
  const handleEnableAlerts = useCallback(() => {
    PermissionManager.openSettings();
    announceAccessibility(
      t('monitoring_continuity_enable_alerts_hint', {
        defaultValue: 'Abra as configurações para ativar alertas do Alert.',
      }),
    );
  }, [announceAccessibility, t]);
  const effectiveStatus = useMemo(() => {
    if (!activeWindPanel) return data.status;
    if (data.status === 'unavailable') return 'none';
    return activeWindPanel.count > 0 ? 'active' : 'none';
  }, [activeWindPanel, data.status]);
  const effectiveTrustStatus = useMemo(() => {
    if (!activeWindPanel) return data.trustStatus;
    return deriveTrustStatus(effectiveUpdatedAt, effectiveStatus);
  }, [activeWindPanel, data.trustStatus, effectiveStatus, effectiveUpdatedAt]);
  const noOfficialLocal = useMemo(
    () =>
      Boolean(data.officialLocalMissing) ||
      data.sourcesFallback ||
      effectiveSources.length === 0 ||
      !hasOfficialSource(effectiveSources),
    [data.officialLocalMissing, data.sourcesFallback, effectiveSources],
  );
  const showContinuityActions = noOfficialLocal || canOpenEvidence;
  const sourceFallbackLabel = useMemo(() => {
    const labels = [
      data.aiConflict ? t('alert_ai_conflict_sources') : '',
      noOfficialLocal
        ? `${t('monitoring_continuity_no_official_local')} ${t('monitoring_continuity_no_official_local_sub')}`
        : data.continuityMode === 'snapshot_verified' || data.continuityMode === 'monitoring'
          ? t('monitoring_continuity_monitoring_now_sub')
          : '',
      data.sourcesFallback && !noOfficialLocal
        ? t('monitoring_overlay_sources_fallback')
        : '',
    ].filter(Boolean);
    return labels.length > 0 ? labels.join(' ') : undefined;
  }, [data.aiConflict, data.continuityMode, data.sourcesFallback, noOfficialLocal, t]);
  const mapBaseLabel =
    baseMapMode === 'satellite'
      ? t('monitoring_map_mode_satellite', { defaultValue: 'Satelite' })
      : t('monitoring_map_mode_default', { defaultValue: 'Padrao' });
  const overlayTitle = t(`monitoring_overlay_title_${item.type}`, {
    defaultValue: itemTitle,
  });
  const isRTL = I18nManager.isRTL;
  const statusLabel =
    data.continuityMode === 'snapshot_verified'
      ? t('monitoring_overlay_status_snapshot_verified', {
          defaultValue: 'Mostrando última verificação',
        })
      : data.continuityMode === 'monitoring'
        ? t('monitoring_overlay_status_monitoring', {
            defaultValue: 'Monitorando agora',
          })
        : t(`monitoring_overlay_status_${effectiveStatus}`);
  const trustLabel =
    effectiveTrustStatus === 'online'
      ? t('monitoring_overlay_freshness_fresh')
      : effectiveTrustStatus === 'stale' || effectiveTrustStatus === 'offline'
        ? t('monitoring_overlay_freshness_stale')
        : t('monitoring_overlay_freshness_unknown');
  const aiSignalPoints = useMemo(
    () => buildSignalPoints(data.aiSignals || []),
    [data.aiSignals],
  );
  const aiSignalPolygons = useMemo(
    () => buildSignalPolygons(data.aiSignals || []),
    [data.aiSignals],
  );
  const aiFocusCoordinate = useMemo(() => {
    const pointCoordinates = aiSignalPoints.features[0]?.geometry?.coordinates;
    if (Array.isArray(pointCoordinates) && pointCoordinates.length >= 2) {
      return [Number(pointCoordinates[0]), Number(pointCoordinates[1])] as [number, number];
    }
    const polygonRing = aiSignalPolygons.features[0]?.geometry?.coordinates?.[0];
    const firstPolygonPoint = Array.isArray(polygonRing) ? polygonRing[0] : null;
    if (Array.isArray(firstPolygonPoint) && firstPolygonPoint.length >= 2) {
      return [Number(firstPolygonPoint[0]), Number(firstPolygonPoint[1])] as [number, number];
    }
    return null;
  }, [aiSignalPoints.features, aiSignalPolygons.features]);
  const hasAiEvidence = Boolean(aiFocusCoordinate);
  const handleApplyAiToMap = useCallback(() => {
    if (!aiFocusCoordinate) return;
    const nextZoom = Math.max(
      Number.isFinite(cameraZoom as number) ? Number(cameraZoom) : SCOPE_ZOOM[scope],
      scope === 'COUNTRY' ? 6 : scope === 'STATE' ? 8 : 11,
    );
    setIsFollowing(false);
    setShowRecenter(true);
    setCameraCenter(aiFocusCoordinate);
    setCameraZoom(nextZoom);
    cameraRef.current?.setCamera?.({
      centerCoordinate: aiFocusCoordinate,
      zoomLevel: nextZoom,
      animationMode: 'easeTo',
      animationDuration: reducedMotion ? 0 : 320,
    });
    announceAccessibility(
      t('alert_ai_apply_map_done', {
        defaultValue: 'Mapa focado na evidencia mais recente.',
      }),
    );
  }, [
    aiFocusCoordinate,
    announceAccessibility,
    cameraZoom,
    reducedMotion,
    scope,
    t,
  ]);
  const legendItems = useMemo(
    () =>
      [
        {
          id: 'event-main',
          icon: item.icon,
          label: t('monitoring_overlay_legend_event_marker', { event: overlayTitle }),
          color: dotColor,
        },
        {
          id: 'sos-near',
          icon: 'shield-alert',
          label: t('monitoring_overlay_legend_sos_marker'),
          color: '#FFD600',
        },
        hasAiEvidence
          ? {
              id: 'ai-signals',
              icon: 'robot-outline',
              label: t('alert_ai_name'),
              color: '#4FC3F7',
            }
          : null,
      ].filter((entry): entry is { id: string; icon: string; label: string; color: string } => Boolean(entry)),
    [dotColor, hasAiEvidence, item.icon, overlayTitle, t],
  );

  const officialAreaPolygons = useMemo(() => {
    const officialPointSource =
      effectiveOfficialPoints.features.length > 0
        ? effectiveOfficialPoints
        : isEpidemicType(item.type)
          ? buildSinglePointCollection(safeUserLocation)
          : EMPTY_FC;

    const areaRadius = isEpidemicType(item.type)
      ? AREA_RADIUS_EPIDEMIC_BY_SCOPE_KM[scope]
      : AREA_RADIUS_BY_SCOPE_KM[scope];

    return buildAreaPolygonsFromPoints(officialPointSource, areaRadius);
  }, [effectiveOfficialPoints, item.type, scope, safeUserLocation]);

  const sosAreaPolygons = useMemo(
    () => buildAreaPolygonsFromPoints(data.sosPoints, SOS_AREA_RADIUS_BY_SCOPE_KM[scope], 10),
    [data.sosPoints, scope],
  );
  const officialAreaOpacity = AREA_FILL_OPACITY_BY_SCOPE[scope];
  const sosAreaOpacity = Math.min(0.2, officialAreaOpacity * 0.72);

  const formattedUpdatedAt = formatUpdatedAtDisplay(effectiveUpdatedAt, locale, timeZone);
  const relativeAgeLabel = formatRelativeAgeLabel(effectiveUpdatedAt, t);
  const verifiedLocalTime =
    formatTime(effectiveUpdatedAt || '', locale, timeZone, {
      hour: '2-digit',
      minute: '2-digit',
    }) || '--';
  const updatedLabel =
    data.continuityMode === 'live' || data.continuityMode === 'trusted_signals'
      ? t('monitoring_overlay_updated_live', {
          defaultValue: `Updated ${relativeAgeLabel} ago • Sources: ${effectiveSources.length}`,
          age: relativeAgeLabel,
          count: effectiveSources.length,
        })
      : data.continuityMode === 'monitoring'
        ? t('monitoring_continuity_monitoring_now_sub', {
            defaultValue: 'Trying to refresh now without losing verified context.',
          })
        : t('monitoring_continuity_snapshot_verified', {
            defaultValue: `Showing last verified information • ${verifiedLocalTime}`,
            time: verifiedLocalTime,
          });

  useEffect(() => {
    if (!effectiveUpdatedAt || formattedUpdatedAt) {
      invalidUpdatedAtTelemetryRef.current = null;
      return;
    }

    const rawUpdatedAt = String(effectiveUpdatedAt);
    if (invalidUpdatedAtTelemetryRef.current === rawUpdatedAt) return;
    invalidUpdatedAtTelemetryRef.current = rawUpdatedAt;

    TelemetryService.trackEvent('monitoring_feed_updated_at_invalid', {
      rawUpdatedAt,
      locale,
      timeZone,
      type: item.type,
    });
  }, [effectiveUpdatedAt, formattedUpdatedAt, item.type, locale, timeZone]);

  const selectWindPanel = useCallback((nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(1, nextIndex));
    setWindPanelIndex(safeIndex);
    windScrollRef.current?.scrollTo({
      x: safeIndex * WIND_PANEL_PAGE_WIDTH,
      y: 0,
      animated: true,
    });
  }, []);

  const onWindPanelScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
    const nextIndex = Math.max(0, Math.min(1, Math.round(offsetX / WIND_PANEL_PAGE_WIDTH)));
    if (nextIndex !== windPanelIndex) {
      setWindPanelIndex(nextIndex);
    }
  }, [windPanelIndex]);

  const sortedPandemicTop3 = useMemo(
    () =>
      Array.isArray(data.pandemicTop3)
        ? [...data.pandemicTop3]
            .sort((a, b) => a.rank - b.rank || b.riskScore - a.riskScore)
            .slice(0, 3)
        : [],
    [data.pandemicTop3],
  );

  useEffect(() => {
    if (!Array.isArray(data.windPanels) || data.windPanels.length < 2) {
      if (windPanelIndex !== 0) setWindPanelIndex(0);
      return;
    }
    if (windPanelIndex > 1) setWindPanelIndex(1);
  }, [data.windPanels, windPanelIndex]);

  useEffect(() => {
    if (sortedPandemicTop3.length === 0) {
      if (pandemicTopIndex !== 0) setPandemicTopIndex(0);
      return;
    }
    if (pandemicTopIndex >= sortedPandemicTop3.length) {
      setPandemicTopIndex(sortedPandemicTop3.length - 1);
    }
  }, [pandemicTopIndex, sortedPandemicTop3.length]);

  const selectPandemicCard = useCallback((nextIndex: number) => {
    const safeIndex = Math.max(0, Math.min(2, nextIndex));
    setPandemicTopIndex(safeIndex);
    pandemicScrollRef.current?.scrollTo({
      x: safeIndex * PANDEMIC_PAGE_WIDTH,
      y: 0,
      animated: true,
    });
  }, []);

  const onPandemicScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = Number(event?.nativeEvent?.contentOffset?.x || 0);
    const nextIndex = Math.max(
      0,
      Math.min(
        Math.max(0, sortedPandemicTop3.length - 1),
        Math.round(offsetX / PANDEMIC_PAGE_WIDTH),
      ),
    );
    if (nextIndex !== pandemicTopIndex) {
      setPandemicTopIndex(nextIndex);
    }
  }, [pandemicTopIndex, sortedPandemicTop3.length]);

  return (
    <ViewShot
      ref={viewShotRef}
      style={styles.page}
      options={{
        format: 'png',
        quality: 1,
        result: 'tmpfile',
        handleGLSurfaceViewOnAndroid: true,
      }}
    >
      <MapLibreGL.MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        mapStyle={resolvedMapStyle}
        scrollEnabled
        zoomEnabled
        rotateEnabled={false}
        pitchEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
        preferredFramesPerSecond={45}
        onDidFinishLoadingMap={handleMapDidFinishLoading}
        onDidFailLoadingMap={handleMapDidFailLoading}
        onRegionDidChange={onRegionDidChange}
      >
        {hasUser ? (
          <MapLibreGL.Camera
            ref={cameraRef}
            centerCoordinate={cameraCenter || [userLon, userLat]}
            zoomLevel={cameraZoom || SCOPE_ZOOM[scope]}
            animationDuration={0}
            minZoomLevel={3}
            maxZoomLevel={18}
          />
        ) : null}

        {aiSignalPolygons.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`ai-polygons-${item.id}`}
            shape={toShapeSourceShape(aiSignalPolygons)}
          >
            <MapLibreGL.FillLayer
              id={`ai-polygons-fill-${item.id}`}
              style={fillLayerStyle({
                fillColor: AI_SIGNAL_COLOR,
                fillOpacity: 0.18,
                fillAntialias: true,
              })}
            />
            <MapLibreGL.LineLayer
              id={`ai-polygons-line-${item.id}`}
              style={lineLayerStyle({
                lineColor: AI_SIGNAL_COLOR,
                lineWidth: 1.4,
                lineOpacity: 0.75,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {aiSignalPoints.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`ai-points-${item.id}`}
            shape={toShapeSourceShape(aiSignalPoints)}
          >
            <MapLibreGL.CircleLayer
              id={`ai-points-core-${item.id}`}
              style={circleLayerStyle({
                circleColor: AI_SIGNAL_COLOR,
                circleRadius: AI_SIGNAL_RADIUS,
                circleStrokeColor: '#FFFFFF',
                circleStrokeWidth: 1.2,
                circleOpacity: 0.92,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {officialAreaPolygons.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`official-areas-${item.id}`}
            shape={toShapeSourceShape(officialAreaPolygons)}
          >
            <MapLibreGL.FillLayer
              id={`official-areas-fill-${item.id}`}
              style={fillLayerStyle({
                fillColor: dotColor,
                fillOpacity: officialAreaOpacity,
                fillAntialias: true,
              })}
            />
            <MapLibreGL.LineLayer
              id={`official-areas-line-${item.id}`}
              style={lineLayerStyle({
                lineColor: withAlpha(dotColor, 0.88),
                lineWidth: 1.15,
                lineOpacity: 0.72,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {effectiveOfficialPoints.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`official-${item.id}`}
            shape={toShapeSourceShape(effectiveOfficialPoints)}
          >
            <MapLibreGL.CircleLayer
              id={`official-circles-${item.id}`}
              style={circleLayerStyle({
                circleColor: dotColor,
                circleRadius: 7,
                circleStrokeColor: '#fff',
                circleStrokeWidth: 1.2,
                circleOpacity: 0.92,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {sosAreaPolygons.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`sos-areas-${item.id}`}
            shape={toShapeSourceShape(sosAreaPolygons)}
          >
            <MapLibreGL.FillLayer
              id={`sos-areas-fill-${item.id}`}
              style={fillLayerStyle({
                fillColor: '#FFD600',
                fillOpacity: sosAreaOpacity,
                fillAntialias: true,
              })}
            />
            <MapLibreGL.LineLayer
              id={`sos-areas-line-${item.id}`}
              style={lineLayerStyle({
                lineColor: 'rgba(255,214,0,0.9)',
                lineWidth: 1.0,
                lineOpacity: 0.68,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {data.sosPoints.features.length > 0 ? (
          <MapLibreGL.ShapeSource
            id={`sos-${item.id}`}
            shape={toShapeSourceShape(data.sosPoints)}
          >
            <MapLibreGL.CircleLayer
              id={`sos-halo-${item.id}`}
              style={circleLayerStyle({
                circleColor: 'rgba(255,214,0,0.22)',
                circleRadius: 16,
                circleOpacity: 0.9,
              })}
            />
            <MapLibreGL.CircleLayer
              id={`sos-core-${item.id}`}
              style={circleLayerStyle({
                circleColor: '#FFD600',
                circleRadius: 8,
                circleStrokeColor: 'rgba(0,0,0,0.55)',
                circleStrokeWidth: 1.4,
                circleOpacity: 0.95,
              })}
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {hasUser ? (
          <MapLibreGL.PointAnnotation id={`me-${item.id}`} coordinate={[userLon, userLat]}>
            <View style={[styles.meMarker, { borderColor: colors.primary }]}>
              <Icon name="crosshairs-gps" size={16} color={colors.primary} />
            </View>
          </MapLibreGL.PointAnnotation>
        ) : null}
      </MapLibreGL.MapView>

      <View style={styles.topShade} pointerEvents="none" />
      <View style={styles.bottomShade} pointerEvents="none" />

      <View style={[styles.topOverlay, { paddingTop: insets.top + 6 }]}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel={t('common_back')}
        >
          <Icon name="arrow-left" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text
            style={styles.headerTitle}
            accessibilityRole="header"
            accessibilityLabel={itemTitle}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {itemTitle}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {t('monitoring_feed_page_counter', { defaultValue: '{{index}} / {{total}}', index: index + 1, total })}
          </Text>
        </View>
      </View>

      <View style={[styles.rail, isRTL ? styles.railRtl : styles.railLtr, { top: insets.top + 72 }]}>
        {scopeBtn(t('monitoring_feed_scope_city'), 'city-variant-outline', 'CITY')}
        {scopeBtn(t('monitoring_feed_scope_state'), 'map-marker-radius-outline', 'STATE')}
        {scopeBtn(t('monitoring_feed_scope_country'), 'earth', 'COUNTRY')}
        <TouchableOpacity
          style={[styles.railBtn, !hasAiEvidence && styles.railBtnDisabled]}
          onPress={handleApplyAiToMap}
          activeOpacity={0.88}
          disabled={!hasAiEvidence}
          accessibilityRole="button"
          accessibilityLabel={t('alert_ai_apply_map')}
          accessibilityHint={t('alert_ai_apply_map_hint')}
          accessibilityState={{ disabled: !hasAiEvidence }}
          hitSlop={ThemeTokens.Monitoring.railHitSlop}
        >
          <Icon name="robot-outline" size={18} color="#FFF" />
          <Text
            style={styles.railBtnText}
            numberOfLines={2}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            allowFontScaling
            maxFontSizeMultiplier={ThemeTokens.Monitoring.railLabelMaxFontScale}
          >
            {t('alert_ai_apply_map')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.railBtn}
          onPress={handleShare}
          activeOpacity={0.88}
          accessibilityRole="button"
          accessibilityLabel={t('monitoring_feed_action_share')}
          accessibilityHint={t('monitoring_feed_action_share_hint')}
          hitSlop={ThemeTokens.Monitoring.railHitSlop}
        >
          <Icon name="share-variant" size={18} color="#FFF" />
          <Text
            style={styles.railBtnText}
            numberOfLines={2}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            allowFontScaling
            maxFontSizeMultiplier={ThemeTokens.Monitoring.railLabelMaxFontScale}
          >
            {t('monitoring_feed_action_share')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.railBtn, saving && styles.railBtnDisabled]}
          onPress={handleSave}
          activeOpacity={0.88}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={
            saving ? t('monitoring_feed_save_label_saving') : t('monitoring_feed_action_save')
          }
          accessibilityHint={t('monitoring_feed_action_save_hint')}
          accessibilityState={{ disabled: saving, busy: saving }}
          hitSlop={ThemeTokens.Monitoring.railHitSlop}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <Icon name="content-save-outline" size={18} color="#FFF" />
          )}
          <Text
            style={styles.railBtnText}
            numberOfLines={2}
            ellipsizeMode="tail"
            adjustsFontSizeToFit
            minimumFontScale={0.78}
            allowFontScaling
            maxFontSizeMultiplier={ThemeTokens.Monitoring.railLabelMaxFontScale}
          >
            {saving
              ? t('monitoring_feed_save_label_saving', { defaultValue: 'Salvando' })
              : t('monitoring_feed_action_save')}
          </Text>
        </TouchableOpacity>
      </View>

      {mapFailed ? (
        <View
          style={[
            styles.mapFailBadge,
            isRTL ? styles.mapFailBadgeRtl : styles.mapFailBadgeLtr,
            { top: insets.top + 132 },
          ]}
        >
          <Icon name="map-marker-alert-outline" size={16} color="#FFF" />
          <Text style={styles.mapFailBadgeText} numberOfLines={1}>
            {t('monitoring_map_unavailable', {
              defaultValue: 'Mapa indisponível — verifique conexão.',
            })}
          </Text>
        </View>
      ) : null}

      {hasUser && showRecenter ? (
        <TouchableOpacity
          style={[
            styles.recenterFloating,
            {
              backgroundColor: recenterBackgroundColor,
              borderColor: recenterBorderColor,
            },
          ]}
          onPress={handleRecenter}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel={t('recenter')}
          accessibilityHint={t('recenter_hint')}
          hitSlop={ThemeTokens.Monitoring.railHitSlop}
        >
          <Icon name="crosshairs-gps" size={15} color={recenterForegroundColor} />
          <Text style={[styles.recenterFloatingText, { color: recenterForegroundColor }]}>{t('recenter')}</Text>
        </TouchableOpacity>
      ) : null}

      <View
        style={[
          styles.bottomOverlay,
          isRTL ? styles.bottomOverlayRtl : styles.bottomOverlayLtr,
          { paddingBottom: insets.bottom + 12 },
        ]}
      >
        <MonitoringInfoOverlay
          title={overlayTitle}
          status={effectiveStatus}
          icon={<HazardSymbolIcon eventType={item.type} fallbackIcon={item.icon} size={16} color="#FFF" />}
          summary={effectiveSummary}
          updatedAt={effectiveUpdatedAt}
          trustStatus={effectiveTrustStatus}
          sources={effectiveSources}
          sourcesLabel={t('monitoring_overlay_sources_label')}
          sourceFallbackLabel={sourceFallbackLabel}
          updatedLabel={updatedLabel}
          statusLabel={statusLabel}
          trustLabel={trustLabel}
          mapMode={baseMapMode}
          mapModeLabel={mapBaseLabel}
          legendLabel={t('monitoring_overlay_legend_label')}
          legendItems={legendItems}
          officialityLabels={{
            OFFICIAL: t('badge_official'),
            VERIFIED: t('badge_verified'),
            REFERENCE: t('badge_reference'),
            TRUSTED_MEDIA: t('badge_trusted_media', { defaultValue: 'Imprensa (verificavel)' }),
            TRUSTED_SOCIAL: t('badge_trusted_social', { defaultValue: 'Conta verificada (link)' }),
            COMMUNITY: t('badge_community', { defaultValue: 'Comunidade (nao verificado)' }),
            ESTIMATED: t('badge_estimated', { defaultValue: 'Estimativa (modelo)' }),
          }}
          swipeHintLabel={t('monitoring_feed_swipe_hint', {
            defaultValue: 'Deslize para cima para o proximo monitoramento',
          })}
          refreshAccessibilityLabel={t('monitoring_action_refresh')}
          refreshAccessibilityHint={t('monitoring_action_refresh_hint')}
          onToggleMapMode={canUseSatellite ? onToggleBaseMapMode : undefined}
          mapModeToggleAccessibilityLabel={
            baseMapMode === 'satellite'
              ? t('monitoring_action_map_default')
              : t('monitoring_action_map_satellite')
          }
          mapModeToggleAccessibilityHint={
            baseMapMode === 'satellite'
              ? t('monitoring_overlay_map_mode_switch_to_default_hint')
              : t('monitoring_overlay_map_mode_switch_to_satellite_hint')
          }
          expandAccessibilityLabel={t('monitoring_info_expand', {
            defaultValue: 'Expandir painel',
          })}
          collapseAccessibilityLabel={t('monitoring_info_collapse', {
            defaultValue: 'Recolher painel',
          })}
          loading={data.loading && active}
          onRefresh={() => void load(true)}
          onOpenSource={openSource}
        >
          {showContinuityActions ? (
            <View style={styles.continuityActionsRow}>
              <TouchableOpacity
                style={[
                  styles.continuityActionBtn,
                  !canOpenEvidence && styles.continuityActionBtnDisabled,
                ]}
                onPress={handleViewEvidence}
                disabled={!canOpenEvidence}
                accessibilityRole="button"
                accessibilityLabel={t('monitoring_continuity_view_evidence')}
                accessibilityHint={t('monitoring_continuity_view_evidence_hint')}
                accessibilityState={{ disabled: !canOpenEvidence }}
              >
                <Icon name="file-document-multiple-outline" size={14} color="#E3F2FD" />
                <Text style={styles.continuityActionText} numberOfLines={1}>
                  {t('monitoring_continuity_view_evidence')}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.continuityActionBtn}
                onPress={handleEnableAlerts}
                accessibilityRole="button"
                accessibilityLabel={t('monitoring_continuity_enable_alerts')}
                accessibilityHint={t('monitoring_continuity_enable_alerts_hint')}
              >
                <Icon name="bell-ring-outline" size={14} color="#E3F2FD" />
                <Text style={styles.continuityActionText} numberOfLines={1}>
                  {t('monitoring_continuity_enable_alerts')}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {isWindMainType(item.type) && Array.isArray(data.windPanels) && data.windPanels.length === 2 ? (
            <View style={styles.windPanelsWrap}>
              <View style={styles.segmentedRow}>
                {data.windPanels.map((panel, idx) => {
                  const selected = windPanelIndex === idx;
                  return (
                    <TouchableOpacity
                      key={panel.id}
                      style={[
                        styles.segmentChip,
                        selected && { backgroundColor: withAlpha(colors.primary, 0.28), borderColor: withAlpha(colors.primary, 0.7) },
                      ]}
                      onPress={() => selectWindPanel(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={t('monitoring_feed_wind_panel_accessibility', {
                        label: panel.label,
                        count: panel.count,
                      })}
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.segmentChipText} numberOfLines={1}>
                        {t('monitoring_feed_wind_speed_label', {
                          speed: idx === 0 ? 10 : 50,
                        })}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <ScrollView
                ref={windScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={WIND_PANEL_PAGE_WIDTH}
                decelerationRate={reducedMotion ? 'normal' : 'fast'}
                onMomentumScrollEnd={onWindPanelScrollEnd}
                contentContainerStyle={styles.horizontalCardsContent}
              >
                {data.windPanels.map(panel => (
                  <View key={panel.id} style={styles.windPanelCard}>
                    <Text style={styles.windPanelTitle} numberOfLines={1}>{panel.label}</Text>
                    <Text style={styles.windPanelMeta} numberOfLines={1}>
                      {t('monitoring_feed_wind_panel_count', {
                        defaultValue: '{{count}} alertas ativos',
                        count: panel.count,
                      })}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            </View>
          ) : null}

          {item.type === 'pandemic' && sortedPandemicTop3.length > 0 ? (
            <View style={styles.pandemicWrap}>
              <View style={styles.segmentedRow}>
                {sortedPandemicTop3.map((entry, idx) => {
                  const selected = pandemicTopIndex === idx;
                  return (
                    <TouchableOpacity
                      key={`${entry.id}-tab`}
                      style={[
                        styles.segmentChip,
                        selected && { backgroundColor: withAlpha(colors.primary, 0.28), borderColor: withAlpha(colors.primary, 0.7) },
                      ]}
                      onPress={() => selectPandemicCard(idx)}
                      accessibilityRole="button"
                      accessibilityLabel={t('monitoring_feed_ranked_item_accessibility', {
                        rank: idx + 1,
                        label: entry.diseaseLabel,
                      })}
                      accessibilityState={{ selected }}
                    >
                      <Text style={styles.segmentChipText} numberOfLines={1}>{`#${idx + 1}`}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <ScrollView
                ref={pandemicScrollRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                snapToInterval={PANDEMIC_PAGE_WIDTH}
                decelerationRate={reducedMotion ? 'normal' : 'fast'}
                onMomentumScrollEnd={onPandemicScrollEnd}
                contentContainerStyle={styles.horizontalCardsContent}
              >
                {sortedPandemicTop3.map((entry, idx) => (
                  <View key={entry.id} style={styles.pandemicCard}>
                    <Text style={styles.pandemicCardTitle} numberOfLines={1}>{`#${idx + 1} ${entry.diseaseLabel}`}</Text>
                    <Text style={styles.pandemicCardMeta} numberOfLines={1}>
                      {t('monitoring_feed_pandemic_score', {
                        defaultValue: 'Score {{score}}',
                        score: entry.riskScore.toFixed(2),
                      })}
                    </Text>
                    <Text style={styles.pandemicCardMeta} numberOfLines={1}>
                      {trendLabelFromValue(entry.trend, t)}
                    </Text>
                  </View>
                ))}
              </ScrollView>
              <Text style={styles.pandemicCounter} numberOfLines={1}>
                {`${Math.min(pandemicTopIndex + 1, sortedPandemicTop3.length)}/${sortedPandemicTop3.length}`}
              </Text>
              <View style={styles.pandemicDotsRow}>
                {sortedPandemicTop3.map((entry, idx) => (
                  <View
                    key={`${entry.id}-dot`}
                    style={[
                      styles.pandemicDot,
                      idx === pandemicTopIndex && styles.pandemicDotActive,
                    ]}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </MonitoringInfoOverlay>
      </View>

      <View style={styles.watermark} pointerEvents="none" accessible={false}>
        <Image source={WATERMARK_LOGO} style={styles.watermarkLogo} resizeMode="contain" />
        <Text style={styles.watermarkText}>Alert</Text>
      </View>
    </ViewShot>
  );
};

const MonitoringFeedScreen = ({ navigation, route }: MonitoringFeedScreenProps) => {
  const { colors } = useTheme();
  const { securityState } = useSecurity();
  const { t, i18n } = useTranslation();
  const screenFocused = useIsFocused();
  const listRef = useRef<FlatList<FeedItem> | null>(null);
  const initialScrollHandledRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [targetLocation, setTargetLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [cursor, setCursor] = useState(FEED_PAGE_SIZE);
  const [activeIndex, setActiveIndex] = useState(0);
  const [baseMapMode, setBaseMapMode] = useState<MapStyleMode>('default');
  const alertAiEnabled = route?.params?.alertAI !== false;
  const canUseSatellite = useMemo(
    () => Boolean(APP_CONFIG.MAP_SATELLITE_ENABLED && HAS_CONFIGURED_SATELLITE_STYLE),
    [],
  );

  const routePriorityTypes = useMemo(
    () =>
      Array.isArray(route?.params?.priorityTypes)
        ? route.params.priorityTypes
            .filter((item: unknown): item is string => typeof item === 'string')
        : [],
    [route?.params?.priorityTypes],
  );
  const catalog = useMemo(() => buildCatalog(routePriorityTypes), [routePriorityTypes]);
  const locale = useMemo(
    () =>
      resolveLocale(
        i18n.resolvedLanguage || i18n.language || getLocales()?.[0]?.languageTag,
      ),
    [i18n.language, i18n.resolvedLanguage],
  );
  const timeZone = useMemo(
    () =>
      resolveTimeZone(
        typeof route?.params?.timeZone === 'string' ? route.params.timeZone : undefined,
      ) || 'UTC',
    [route?.params?.timeZone],
  );
  const securityLat =
    typeof securityState.location?.latitude === 'number'
      ? securityState.location.latitude
      : null;
  const securityLon =
    typeof securityState.location?.longitude === 'number'
      ? securityState.location.longitude
      : null;
  const userLocation: MonitoringCoordinate | null =
    canUseLocationForRiskMaps(securityState) &&
    securityLat !== null &&
    securityLon !== null &&
    isFiniteCoordinatePair(securityLat, securityLon)
      ? { latitude: securityLat, longitude: securityLon }
      : null;

  const initialType = typeof route?.params?.type === 'string'
    ? route.params.type
    : typeof route?.params?.initialCategory === 'string'
      ? route.params.initialCategory
      : undefined;
  const initialIndex = useMemo(() => {
    if (!initialType) return 0;
    const idx = catalog.findIndex(item => item.type === initialType);
    return idx >= 0 ? idx : 0;
  }, [catalog, initialType]);

  const initialScope = (typeof route?.params?.scope === 'string'
    ? String(route.params.scope).toUpperCase()
    : 'CITY') as FeedScope;
  const initialCenter =
    typeof route?.params?.lat === 'number' && typeof route?.params?.lon === 'number'
      ? { latitude: route.params.lat, longitude: route.params.lon }
      : null;
  const initialZoom =
    typeof route?.params?.zoom === 'number' && Number.isFinite(route.params.zoom)
      ? Number(route.params.zoom)
      : null;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => mounted && setReducedMotion(Boolean(v))).catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    void GetDefaultRouteDestinationQuery.execute()
      .then(dest => {
        if (!dest) return;
        setTargetLocation({ latitude: dest.latitude, longitude: dest.longitude });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(MONITORING_MAP_STYLE_STORAGE_KEY)
      .then(stored => {
        if (!active) return;
        if (stored === 'satellite' && canUseSatellite) {
          setBaseMapMode('satellite');
          return;
        }
        setBaseMapMode('default');
      })
      .catch(() => {
        if (active) setBaseMapMode('default');
      });
    return () => {
      active = false;
    };
  }, [canUseSatellite]);

  const toggleBaseMapMode = useCallback(() => {
    if (!canUseSatellite) return;
    setBaseMapMode(prev => {
      const next: MapStyleMode = prev === 'satellite' ? 'default' : 'satellite';
      AsyncStorage.setItem(MONITORING_MAP_STYLE_STORAGE_KEY, next).catch(() => {});
      return next;
    });
  }, [canUseSatellite]);

  useEffect(() => {
    if (initialIndex + 1 > cursor) {
      setCursor(Math.min(catalog.length, Math.max(FEED_PAGE_SIZE, initialIndex + 1)));
    }
  }, [catalog.length, cursor, initialIndex]);

  const items = useMemo(() => catalog.slice(0, cursor), [catalog, cursor]);

  useEffect(() => {
    initialScrollHandledRef.current = false;
  }, [initialIndex]);

  useEffect(() => {
    if (initialScrollHandledRef.current) return;
    if (initialIndex <= 0) {
      initialScrollHandledRef.current = true;
      return;
    }
    if (initialIndex >= items.length) return;
    const id = setTimeout(() => {
      listRef.current?.scrollToIndex?.({ index: initialIndex, animated: false });
      setActiveIndex(initialIndex);
      initialScrollHandledRef.current = true;
    }, 0);
    return () => clearTimeout(id);
  }, [initialIndex, items.length]);

  const onEndReached = useCallback(() => {
    setCursor(prev => (prev >= catalog.length ? prev : Math.min(catalog.length, prev + FEED_PAGE_SIZE)));
  }, [catalog.length]);

  const onScrollToIndexFailed = useCallback(
    ({ index }: { index: number }) => {
      const safeIndex = Math.max(0, Math.min(index, Math.max(0, items.length - 1)));
      listRef.current?.scrollToOffset?.({
        offset: safeIndex * SCREEN_HEIGHT,
        animated: false,
      });
      setTimeout(() => {
        listRef.current?.scrollToIndex?.({ index: safeIndex, animated: false });
      }, 80);
    },
    [items.length],
  );

  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find(v => v.isViewable && typeof v.index === 'number');
    if (typeof first?.index === 'number') setActiveIndex(first.index);
  }).current;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} edges={[]}>
      <FlatList
        ref={listRef}
        data={items}
        keyExtractor={item => item.id}
        renderItem={({ item, index }) => (
          <View style={{ height: SCREEN_HEIGHT }}>
            <FeedMapPage
              item={item}
              index={index}
              total={catalog.length}
              active={index === activeIndex}
              locale={locale}
              timeZone={timeZone}
              userLocation={userLocation}
              targetLocation={targetLocation}
              reducedMotion={reducedMotion}
              initialScope={index === initialIndex ? initialScope : 'CITY'}
              initialCenter={index === initialIndex ? initialCenter : null}
              initialZoom={index === initialIndex ? initialZoom : null}
              baseMapMode={baseMapMode}
              canUseSatellite={canUseSatellite}
              onToggleBaseMapMode={toggleBaseMapMode}
              alertAiEnabled={alertAiEnabled}
              screenFocused={screenFocused}
              colors={colors}
              t={t}
              onBack={() => navigation.goBack()}
            />
          </View>
        )}
        pagingEnabled
        snapToInterval={SCREEN_HEIGHT}
        snapToAlignment="start"
        decelerationRate={reducedMotion ? 'normal' : 'fast'}
        showsVerticalScrollIndicator={false}
        initialNumToRender={1}
        maxToRenderPerBatch={2}
        windowSize={3}
        removeClippedSubviews
        initialScrollIndex={0}
        getItemLayout={(_, index) => ({ length: SCREEN_HEIGHT, offset: SCREEN_HEIGHT * index, index })}
        onEndReachedThreshold={0.6}
        onEndReached={onEndReached}
        onScrollToIndexFailed={onScrollToIndexFailed}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={onViewableItemsChanged}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { flex: 1, backgroundColor: '#000' },
  topShade: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 120,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  bottomShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
    backgroundColor: 'rgba(0,0,0,0.26)',
  },
  topOverlay: {
    position: 'absolute',
    left: ThemeTokens.spacing.md,
    right: ThemeTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
  },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: {
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  headerSub: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    fontFamily: FONT_FAMILY,
    marginTop: 2,
  },
  rail: {
    position: 'absolute',
    width: 160,
    gap: ThemeTokens.Monitoring.railGap,
  },
  railLtr: {
    right: ThemeTokens.spacing.md,
  },
  railRtl: {
    left: ThemeTokens.spacing.md,
  },
  railBtn: {
    minWidth: ThemeTokens.Monitoring.railButtonSize,
    minHeight: ThemeTokens.Monitoring.railButtonSize,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(0,0,0,0.58)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  railBtnText: {
    color: '#FFF',
    fontSize: ThemeTokens.Monitoring.railLabelFontSize,
    lineHeight: ThemeTokens.Monitoring.railLabelFontSize + 2,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    flex: 1,
    minWidth: 0,
  },
  railBtnDisabled: {
    opacity: 0.7,
  },
  recenterFloating: {
    position: 'absolute',
    right: ThemeTokens.spacing.md + 2,
    bottom: 220,
    minHeight: ThemeTokens.Monitoring.buttonSize,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recenterFloatingText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  bottomOverlay: {
    position: 'absolute',
    bottom: 0,
    maxWidth: ThemeTokens.Monitoring.overlayMaxWidth,
  },
  bottomOverlayLtr: {
    left: ThemeTokens.spacing.md,
    right: ThemeTokens.spacing.md + RAIL_OVERLAY_OFFSET,
  },
  bottomOverlayRtl: {
    left: ThemeTokens.spacing.md + RAIL_OVERLAY_OFFSET,
    right: ThemeTokens.spacing.md,
  },
  windPanelsWrap: {
    gap: 8,
  },
  continuityActionsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  continuityActionBtn: {
    minHeight: 34,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
  },
  continuityActionBtnDisabled: {
    opacity: 0.62,
  },
  continuityActionText: {
    color: '#E3F2FD',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    maxWidth: 150,
  },
  pandemicWrap: {
    gap: 8,
  },
  segmentedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  segmentChip: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  segmentChipText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  horizontalCardsContent: {
    gap: 8,
  },
  windPanelCard: {
    width: WIND_PANEL_CARD_WIDTH,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  windPanelTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  windPanelMeta: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 11,
    fontFamily: FONT_FAMILY,
  },
  pandemicCard: {
    width: PANDEMIC_CARD_WIDTH,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(66,165,245,0.48)',
    backgroundColor: 'rgba(66,165,245,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 4,
  },
  pandemicCardTitle: {
    color: '#E3F2FD',
    fontSize: 12,
    fontWeight: '900',
    fontFamily: FONT_FAMILY,
  },
  pandemicCardMeta: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  pandemicCounter: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    alignSelf: 'flex-end',
  },
  pandemicDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  pandemicDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
  pandemicDotActive: {
    backgroundColor: '#42A5F5',
  },
  mapFailBadge: {
    position: 'absolute',
    minHeight: 36,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: ThemeTokens.Monitoring.mapFailBadgeBg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  mapFailBadgeLtr: {
    left: ThemeTokens.spacing.md,
    right: ThemeTokens.spacing.md + RAIL_OVERLAY_OFFSET,
  },
  mapFailBadgeRtl: {
    left: ThemeTokens.spacing.md + RAIL_OVERLAY_OFFSET,
    right: ThemeTokens.spacing.md,
  },
  mapFailBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    flex: 1,
  },
  meMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  watermark: {
    position: 'absolute',
    right: 14,
    bottom: 16,
    alignItems: 'center',
    opacity: 0.28,
  },
  watermarkLogo: {
    width: 24,
    height: 24,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  watermarkText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
    marginTop: 3,
  },
});

export default MonitoringFeedScreen;

