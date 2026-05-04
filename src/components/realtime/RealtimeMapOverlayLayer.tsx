import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import { OSM_STYLE_SATELLITE } from '../../constants/MapStyles';
import { GetRealtimeMapOverlayQuery } from '../../application/queries/GetRealtimeMapOverlayQuery';
import { TelemetryService } from '../../services/TelemetryService';
import {
  formatUpdatedAtDisplay,
  isInvalidFormattedDateLike,
  isNativeDateStringLike,
  normalizeToIsoDateTime,
} from '../../utils/dateTimeFormat';

type RealtimeMapOverlayLayerProps = {
  categoryId: string;
  categoryLabel: string;
  locale: string;
  timeZone?: string;
  userLocation: { latitude: number; longitude: number } | null | undefined;
  contextOnly?: boolean;
  updatedAtOverride?: string | null;
  colors: {
    background: string;
    card: string;
    border: string;
    text: string;
    textSecondary: string;
    primary: string;
    alert: string;
    safe: string;
    riskMedium: string;
  };
  t: (key: string, options?: any) => string;
};

type OverlayHeatmap = {
  type: 'FeatureCollection';
  features: Array<any>;
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const colorForCategory = (categoryId: string, fallback: string) => {
  const id = String(categoryId || '').toLowerCase();
  if (id.includes('energy')) return '#FFD54F';
  if (id.includes('water') || id.includes('flood') || id.includes('tsunami')) return '#4FC3F7';
  if (id.includes('fire') || id.includes('heat') || id.includes('volcano')) return '#FF7043';
  if (id.includes('earthquake') || id.includes('landslide')) return '#EF5350';
  if (id.includes('wind') || id.includes('storm') || id.includes('cyclone') || id.includes('tornado'))
    return '#AB47BC';
  if (id.includes('pandemic') || id.includes('epidemic')) return '#29B6F6';
  return fallback;
};

const buildOverlayShape = (heatmap: OverlayHeatmap) => {
  const features = Array.isArray(heatmap?.features)
    ? heatmap.features
        .filter(item => Number(item?.properties?.score || 0) > 0)
        .slice(0, 220)
        .map(item => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: item.geometry.coordinates },
          properties: {
            score: Number(item.properties?.score || 0),
            count: Number(item.properties?.count || 0),
          },
        }))
    : [];
  return { type: 'FeatureCollection', features } as any;
};

const getCenterFromPayload = (payload: any): [number, number] | null => {
  const coords = payload?.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) return [coords[0], coords[1]];
  const center = payload?.properties?.center;
  if (Array.isArray(center) && center.length >= 2) return [center[0], center[1]];
  if (Array.isArray(payload?.centerCoordinate) && payload.centerCoordinate.length >= 2) {
    return [payload.centerCoordinate[0], payload.centerCoordinate[1]];
  }
  return null;
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

const uniqueSources = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map(v => String(v || '').trim()).filter(Boolean)));

export const RealtimeMapOverlayLayer = memo((props: RealtimeMapOverlayLayerProps) => {
  const { isDark } = useTheme();
  const {
    categoryId,
    categoryLabel,
    locale,
    timeZone,
    userLocation,
    contextOnly = false,
    updatedAtOverride,
    colors,
    t,
  } = props;
  const [loading, setLoading] = useState(true);
  const [heatmap, setHeatmap] = useState<OverlayHeatmap>({
    type: 'FeatureCollection',
    features: [],
  });
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [summaries, setSummaries] = useState<Record<string, string>>({});
  const [sourceLine, setSourceLine] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [cameraCenter, setCameraCenter] = useState<[number, number] | null>(null);
  const [showRecenter, setShowRecenter] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);
  const mountedRef = useRef(true);
  const hasLoadedOnceRef = useRef(false);
  const invalidUpdatedAtTelemetryRef = useRef<string | null>(null);

  const overlayColor = useMemo(
    () => colorForCategory(categoryId, colors.primary),
    [categoryId, colors.primary],
  );
  const mapShape = useMemo(() => buildOverlayShape(heatmap), [heatmap]);
  const recenterForegroundColor = isDark ? '#FFFFFF' : '#111111';
  const recenterBackgroundColor = isDark ? '#111111' : '#FFFFFF';
  const recenterBorderColor = isDark ? 'rgba(255,255,255,0.16)' : 'rgba(17,17,17,0.12)';

  const latitude = typeof userLocation?.latitude === 'number' ? userLocation.latitude : null;
  const longitude = typeof userLocation?.longitude === 'number' ? userLocation.longitude : null;
  const hasUser = latitude !== null && longitude !== null;

  useEffect(() => {
    if (!hasUser || latitude === null || longitude === null) return;
    if (!isFollowing) return;
    setCameraCenter([longitude, latitude]);
    setShowRecenter(false);
  }, [hasUser, isFollowing, latitude, longitude]);

  const load = useCallback(
    async (force = false) => {
      if (!hasUser || latitude === null || longitude === null) {
        if (mountedRef.current) {
          setHeatmap({ type: 'FeatureCollection', features: [] });
          setActiveIds(new Set());
          setSummaries({});
          setLoading(false);
        }
        return;
      }

      if (mountedRef.current && !hasLoadedOnceRef.current) setLoading(true);
      try {
        const payload = await GetRealtimeMapOverlayQuery.execute({
          categoryId,
          latitude,
          longitude,
          contextOnly,
          updatedAtOverride,
        });

        if (!mountedRef.current) return;
        const wasFirstLoad = !hasLoadedOnceRef.current;
        const sources = uniqueSources(payload.sourceNames).slice(0, 3);
        setHeatmap(payload.heatmap);
        setActiveIds(new Set(payload.activeIds));
        setSummaries(payload.summaries);
        setSourceLine(
          sources.length > 0
            ? `${t('epidemic_map_source_prefix', { source: sources.join(' | ') })}`
            : contextOnly
              ? ''
              : t('official_sources_load_error', {
                  defaultValue: 'Fonte oficial indisponivel.',
                }),
        );
        setUpdatedAt(
          normalizeToIsoDateTime(payload.updatedAt) || payload.updatedAt || null,
        );
        hasLoadedOnceRef.current = true;

        if (force && (contextOnly || wasFirstLoad) && isFollowing) {
          cameraRef.current?.setCamera({
            centerCoordinate: [longitude, latitude],
            zoomLevel: 14,
            animationDuration: 250,
            animationMode: 'easeTo',
          });
        }
      } catch {
        if (!mountedRef.current) return;
      } finally {
        if (mountedRef.current && !hasLoadedOnceRef.current) setLoading(false);
        if (mountedRef.current && hasLoadedOnceRef.current) setLoading(false);
      }
    },
    [categoryId, contextOnly, hasUser, isFollowing, latitude, longitude, t, updatedAtOverride],
  );

  useEffect(() => {
    mountedRef.current = true;
    void load(true);
    return () => {
      mountedRef.current = false;
    };
  }, [load, categoryId]);

  useEffect(() => {
    const id = setInterval(() => {
      void load(false);
    }, 45_000);
    return () => clearInterval(id);
  }, [load]);

  const activeSummary = contextOnly
    ? t('realtime_context_map_disclaimer', {
        defaultValue: 'Mapa de contexto da localização. Dados oficiais exibidos nos painéis abaixo.',
      })
    : activeIds.has(categoryId)
      ? summaries[categoryId] || t('monitoring_alert_active')
      : t('monitoring_no_alerts');

  const handleRegionDidChange = useCallback(
    (payload: any) => {
      if (!hasUser || latitude === null || longitude === null) return;
      const center = getCenterFromPayload(payload);
      if (!center) return;
      setCameraCenter(center);
      const dist = distanceMeters(
        { lat: latitude, lon: longitude },
        { lat: center[1], lon: center[0] },
      );
      const shouldShow = dist > 60;
      if (shouldShow !== showRecenter) {
        setShowRecenter(shouldShow);
      }
      if (shouldShow && isFollowing) {
        setIsFollowing(false);
      }
    },
    [hasUser, isFollowing, latitude, longitude, showRecenter],
  );

  const handleRecenter = useCallback(() => {
    if (!hasUser || latitude === null || longitude === null) return;
    setIsFollowing(true);
    setShowRecenter(false);
    const center: [number, number] = [longitude, latitude];
    setCameraCenter(center);
    cameraRef.current?.setCamera({
      centerCoordinate: center,
      zoomLevel: 14,
      animationMode: 'easeTo',
      animationDuration: 300,
    });
  }, [hasUser, latitude, longitude]);
  const formattedUpdatedAt = formatUpdatedAtDisplay(updatedAtOverride || updatedAt, locale, timeZone);
  const updatedDisplay =
    formattedUpdatedAt &&
    !isInvalidFormattedDateLike(formattedUpdatedAt) &&
    !isNativeDateStringLike(formattedUpdatedAt)
      ? formattedUpdatedAt
      : '--';

  useEffect(() => {
    const rawUpdatedAt = String(updatedAtOverride || updatedAt || '').trim();
    if (!rawUpdatedAt || formattedUpdatedAt) {
      invalidUpdatedAtTelemetryRef.current = null;
      return;
    }
    if (invalidUpdatedAtTelemetryRef.current === rawUpdatedAt) return;
    invalidUpdatedAtTelemetryRef.current = rawUpdatedAt;

    TelemetryService.trackEvent('realtime_overlay_updated_at_invalid', {
      rawUpdatedAt,
      locale,
      timeZone,
      categoryId,
    });
  }, [categoryId, formattedUpdatedAt, locale, timeZone, updatedAt, updatedAtOverride]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
        },
      ]}
      accessibilityRole="image"
      accessibilityLabel={`${categoryLabel}. ${activeSummary}`}
    >
      <View style={styles.headerRow}>
        <View style={styles.headerTitleWrap}>
          <View style={[styles.dot, { backgroundColor: overlayColor }]} />
          <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
            {categoryLabel}
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => void load(true)}
          style={[styles.refreshBtn, { borderColor: colors.border }]}
          accessibilityRole="button"
          accessibilityLabel={t('common_refresh')}
        >
          <Icon name="refresh" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <Text style={[styles.headerSub, { color: colors.textSecondary }]} numberOfLines={2}>
        {activeSummary}
      </Text>

      <View style={[styles.mapWrap, { borderColor: colors.border, backgroundColor: colors.background }]}>
        {hasUser && latitude !== null && longitude !== null ? (
          <MapLibreGL.MapView
            style={styles.map}
            mapStyle={OSM_STYLE_SATELLITE}
            scrollEnabled
            zoomEnabled
            rotateEnabled={false}
            pitchEnabled={false}
            compassEnabled={false}
            attributionEnabled={false}
            logoEnabled={false}
            preferredFramesPerSecond={45}
            regionDidChangeDebounceTime={250}
            onRegionDidChange={handleRegionDidChange}
          >
            <MapLibreGL.Camera
              ref={cameraRef}
              centerCoordinate={cameraCenter || [longitude, latitude]}
              zoomLevel={14}
              animationDuration={0}
              maxZoomLevel={18}
            />

            {!contextOnly && mapShape.features.length > 0 ? (
              <MapLibreGL.ShapeSource id={`realtime-overlay-${categoryId}`} shape={mapShape}>
                <MapLibreGL.CircleLayer
                  id={`realtime-overlay-circles-${categoryId}`}
                  style={
                    {
                      circleColor: [
                        'step',
                        ['get', 'score'],
                        `${overlayColor}55`,
                        2,
                        `${overlayColor}AA`,
                        4,
                        `${overlayColor}`,
                      ],
                      circleRadius: [
                        'interpolate',
                        ['linear'],
                        ['get', 'score'],
                        0,
                        5,
                        2,
                        9,
                        4,
                        14,
                        7,
                        18,
                      ],
                      circleStrokeColor: 'rgba(255,255,255,0.85)',
                      circleStrokeWidth: 1,
                      circleOpacity: 0.9,
                    } as any
                  }
                />
              </MapLibreGL.ShapeSource>
            ) : null}

            <MapLibreGL.PointAnnotation
              id={`realtime-me-${categoryId}`}
              coordinate={[longitude, latitude]}
            >
              <View style={[styles.meMarker, { borderColor: colors.primary }]}>
                <Icon name="crosshairs-gps" size={16} color={colors.primary} />
              </View>
            </MapLibreGL.PointAnnotation>
          </MapLibreGL.MapView>
        ) : (
          <View style={styles.emptyWrap}>
            <Icon name="map-marker-off" size={20} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{t('map_no_location')}</Text>
          </View>
        )}

        {loading ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : null}

        {hasUser && showRecenter ? (
          <TouchableOpacity
            style={[
              styles.recenterButton,
              { backgroundColor: recenterBackgroundColor, borderColor: recenterBorderColor },
            ]}
            onPress={handleRecenter}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={t('recenter')}
          >
            <Icon name="crosshairs-gps" size={14} color={recenterForegroundColor} />
            <Text style={[styles.recenterText, { color: recenterForegroundColor }]}>{t('recenter')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {!contextOnly ? (
        <Text style={[styles.sourceText, { color: colors.textSecondary }]} numberOfLines={2}>
          {sourceLine}
        </Text>
      ) : null}

      <Text style={[styles.updatedText, { color: colors.textSecondary }]} numberOfLines={1}>
        {`${t('epidemic_map_updated_prefix')} ${updatedDisplay}`}
      </Text>
    </View>
  );
});

RealtimeMapOverlayLayer.displayName = 'RealtimeMapOverlayLayer';

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.md,
    gap: ThemeTokens.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ThemeTokens.spacing.sm,
  },
  headerTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
    flexShrink: 1,
  },
  headerSub: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: FONT_FAMILY,
  },
  refreshBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapWrap: {
    height: 260,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
  },
  recenterButton: {
    position: 'absolute',
    right: 12,
    bottom: 10,
    height: 34,
    paddingHorizontal: 10,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recenterText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  sourceText: {
    fontSize: 11,
    lineHeight: 15,
    fontFamily: FONT_FAMILY,
  },
  map: {
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
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 12,
    fontFamily: FONT_FAMILY,
  },
  updatedText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});

export default RealtimeMapOverlayLayer;
