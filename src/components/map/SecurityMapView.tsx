import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {
  HAS_CONFIGURED_SATELLITE_STYLE,
  MAP_MAX_ZOOM,
  MAP_STYLE_DEFAULT,
  MAP_STYLE_SAFE_FALLBACK,
  MAP_STYLE_SATELLITE,
  MapStyleMode,
} from '../../constants/MapStyles';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import {
  SecurityGlyph,
  SecurityIncidentItem,
} from '../../services/data/UnifiedIncidentStore';
import { ProfileService } from '../../services/ProfileService';
import CityGlyph from './CityGlyph';

type Props = {
  userLocation: { latitude: number; longitude: number } | null;
  glyphs: SecurityGlyph[];
  incidents: SecurityIncidentItem[];
  chromeHidden: boolean;
  mapMode: MapStyleMode;
  profileRefreshKey?: number;
  onToggleMapMode: () => void;
  onMapPress: () => void;
  mapModeLabel: string;
  recenterLabel: string;
  loadingLabel: string;
  unavailableLabel: string;
  watermarkText: string;
  watermarkFooter: string;
  updatedAtFooter: string;
  timeRangeLabel: string;
  timeNowLabel: string;
  timeFutureLabel: string;
  liveDataLabel: string;
  onGlyphPress: (glyph: SecurityGlyph) => void;
};

const WATERMARK_LOGO = require('../../assets/logo.png');

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type PointFeature = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: {
    severity: string;
  };
};

const severityToColor = (severity: string) => {
  if (severity === 'critical' || severity === 'high') return '#EF5350';
  if (severity === 'medium') return '#FFB74D';
  return '#66BB6A';
};

export const SecurityMapView: React.FC<Props> = ({
  userLocation,
  glyphs,
  incidents,
  chromeHidden,
  mapMode,
  profileRefreshKey,
  onToggleMapMode,
  onMapPress,
  mapModeLabel,
  recenterLabel,
  loadingLabel,
  unavailableLabel,
  watermarkText,
  watermarkFooter,
  updatedAtFooter,
  timeRangeLabel,
  timeNowLabel,
  timeFutureLabel,
  liveDataLabel,
  onGlyphPress,
}) => {
  const { isDark } = useTheme();
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);
  const [cameraCenter, setCameraCenter] = useState<[number, number]>(
    userLocation ? [userLocation.longitude, userLocation.latitude] : [-46.6333, -23.5505],
  );
  const [cameraZoom, setCameraZoom] = useState(11.2);
  const [showRecenter, setShowRecenter] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [resolvedMapStyle, setResolvedMapStyle] = useState<any>(MAP_STYLE_DEFAULT);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const canUseSatellite = HAS_CONFIGURED_SATELLITE_STYLE;
  const isRTL = I18nManager.isRTL;
  const recenterForegroundColor = isDark ? '#FFFFFF' : '#111111';
  const recenterBackgroundColor = isDark ? 'rgba(17,17,17,0.82)' : 'rgba(255,255,255,0.96)';
  const recenterBorderColor = isDark ? 'rgba(255,255,255,0.18)' : 'rgba(17,17,17,0.12)';
  const sideInsetStyle = isRTL ? styles.sideInsetLeft : styles.sideInsetRight;
  const floatingBtnStyle = isRTL ? styles.floatingLeft : styles.floatingRight;
  const recenterBtnStyle = isRTL ? styles.recenterLeft : styles.recenterRight;

  const mapStyle = useMemo(() => {
    if (mapMode === 'satellite' && canUseSatellite) return MAP_STYLE_SATELLITE;
    return MAP_STYLE_DEFAULT;
  }, [canUseSatellite, mapMode]);

  useEffect(() => {
    setResolvedMapStyle(mapStyle);
    setMapReady(false);
    setMapFailed(false);
    setUsingFallbackStyle(false);
  }, [mapStyle]);

  useEffect(() => {
    if (userLocation) {
      setCameraCenter([userLocation.longitude, userLocation.latitude]);
    }
  }, [userLocation?.latitude, userLocation?.longitude]);

  useEffect(() => {
    let active = true;
    ProfileService.getProfile()
      .then(profile => {
        if (!active) return;
        const uri = typeof profile?.avatarUri === 'string' ? profile.avatarUri.trim() : '';
        setAvatarUri(uri ? uri : null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profileRefreshKey]);

  const incidentPoints = useMemo(() => {
    const features: PointFeature[] = incidents
      .filter(item => item.coordinate)
      .map(item => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [item.coordinate!.longitude, item.coordinate!.latitude],
        },
        properties: {
          severity: item.severity,
        },
      }));
    return {
      type: 'FeatureCollection',
      features,
    };
  }, [incidents]);

  const handleRegionDidChange = useCallback((payload: any) => {
    const coords = payload?.geometry?.coordinates;
    const center =
      Array.isArray(coords) && coords.length >= 2
        ? [Number(coords[0]), Number(coords[1])]
        : Array.isArray(payload?.properties?.center) && payload.properties.center.length >= 2
          ? [Number(payload.properties.center[0]), Number(payload.properties.center[1])]
          : null;
    const zoom = Number(payload?.properties?.zoomLevel ?? payload?.zoomLevel ?? payload?.zoom);
    if (center && Number.isFinite(center[0]) && Number.isFinite(center[1])) {
      setCameraCenter([center[0], center[1]]);
      if (userLocation) {
        const dLat = Math.abs(userLocation.latitude - center[1]);
        const dLon = Math.abs(userLocation.longitude - center[0]);
        setShowRecenter(dLat > 0.002 || dLon > 0.002);
      }
    }
    if (Number.isFinite(zoom)) {
      setCameraZoom(zoom);
    }
  }, [userLocation]);

  const handleRecenter = useCallback(() => {
    if (!userLocation) return;
    const center: [number, number] = [userLocation.longitude, userLocation.latitude];
    setCameraCenter(center);
    setCameraZoom(11.5);
    setShowRecenter(false);
    cameraRef.current?.setCamera?.({
      centerCoordinate: center,
      zoomLevel: 11.5,
      animationMode: 'easeTo',
      animationDuration: 320,
    });
  }, [userLocation]);

  const handleMapDidFailLoading = useCallback(() => {
    if (!usingFallbackStyle) {
      setUsingFallbackStyle(true);
      setResolvedMapStyle(MAP_STYLE_SAFE_FALLBACK);
      setMapFailed(false);
      return;
    }
    setMapFailed(true);
  }, [usingFallbackStyle]);

  return (
    <View style={styles.container}>
      <MapLibreGL.MapView
        style={styles.map}
        mapStyle={resolvedMapStyle}
        rotateEnabled={false}
        pitchEnabled={false}
        attributionEnabled={false}
        logoEnabled={false}
        compassEnabled={false}
        preferredFramesPerSecond={45}
        regionDidChangeDebounceTime={220}
        onDidFinishLoadingMap={() => {
          setMapReady(true);
          setMapFailed(false);
        }}
        onDidFailLoadingMap={handleMapDidFailLoading}
        onRegionDidChange={handleRegionDidChange}
        onPress={(event: any) => {
          const featureCount = Array.isArray(event?.features) ? event.features.length : 0;
          if (featureCount > 0) return;
          onMapPress();
        }}
      >
        <MapLibreGL.Camera
          ref={cameraRef}
          centerCoordinate={cameraCenter}
          zoomLevel={cameraZoom}
          maxZoomLevel={MAP_MAX_ZOOM}
          animationDuration={0}
        />

        {incidentPoints.features.length > 0 ? (
          <MapLibreGL.ShapeSource id="security-incident-points" shape={incidentPoints as any}>
            <MapLibreGL.CircleLayer
              id="security-incident-layer"
              style={
                {
                  circleRadius: 8,
                  circleOpacity: 0.8,
                  circleStrokeWidth: 1.4,
                  circleStrokeColor: 'rgba(255,255,255,0.5)',
                  circleColor: [
                    'match',
                    ['get', 'severity'],
                    'critical',
                    severityToColor('critical'),
                    'high',
                    severityToColor('high'),
                    'medium',
                    severityToColor('medium'),
                    severityToColor('low'),
                  ],
                } as any
              }
            />
          </MapLibreGL.ShapeSource>
        ) : null}

        {userLocation ? (
          <MapLibreGL.MarkerView
            id="security-map-user"
            coordinate={[userLocation.longitude, userLocation.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.userMarker}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.userAvatar} />
              ) : (
                <Image source={WATERMARK_LOGO} style={styles.userLogo} resizeMode="contain" />
              )}
            </View>
          </MapLibreGL.MarkerView>
        ) : null}

        {glyphs.map(glyph => (
          <MapLibreGL.PointAnnotation
            key={glyph.id}
            id={`security-glyph-${glyph.id}`}
            coordinate={[glyph.longitude, glyph.latitude]}
            onSelected={() => onGlyphPress(glyph)}
          >
            <CityGlyph
              total={glyph.total}
              confidence={glyph.confidence}
              domains={glyph.domains}
            />
          </MapLibreGL.PointAnnotation>
        ))}
      </MapLibreGL.MapView>

      {!mapReady && !mapFailed ? (
        <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.46)' }]}>
          <Icon name="map-clock-outline" size={14} color="#FFFFFF" />
          <Text style={styles.badgeText} numberOfLines={1}>
            {loadingLabel}
          </Text>
        </View>
      ) : null}

      {mapFailed ? (
        <View style={[styles.badge, { backgroundColor: 'rgba(0,0,0,0.64)' }]}>
          <Icon name="map-marker-alert-outline" size={14} color="#FFFFFF" />
          <Text style={styles.badgeText} numberOfLines={1}>
            {unavailableLabel}
          </Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.mapModeBtn, floatingBtnStyle]}
        onPress={onToggleMapMode}
        accessibilityRole="button"
        accessibilityLabel={mapModeLabel}
        hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
      >
        <Icon
          name={mapMode === 'satellite' ? 'map-outline' : 'satellite-variant'}
          size={16}
          color="#FFFFFF"
        />
      </TouchableOpacity>

      {showRecenter ? (
        <TouchableOpacity
          style={[
            styles.recenterBtn,
            recenterBtnStyle,
            chromeHidden ? styles.recenterBtnCompact : null,
            {
              backgroundColor: recenterBackgroundColor,
              borderColor: recenterBorderColor,
            },
          ]}
          onPress={handleRecenter}
          accessibilityRole="button"
          accessibilityLabel={recenterLabel}
          hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
        >
          <Icon name="crosshairs-gps" size={16} color={recenterForegroundColor} />
          <Text style={[styles.recenterText, { color: recenterForegroundColor }]}>{recenterLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {!chromeHidden ? (
        <View style={[styles.liveBadge, sideInsetStyle]} pointerEvents="none">
          <Icon name="circle-medium" size={14} color="#2ECC71" />
          <Text style={styles.liveBadgeText} numberOfLines={1}>
            {liveDataLabel}
          </Text>
        </View>
      ) : null}

      {!chromeHidden ? (
        <View style={styles.timelineCard} pointerEvents="none">
          <Text style={styles.timelineLabel}>{timeRangeLabel}</Text>
          <Text style={styles.timelineNow}>{timeNowLabel}</Text>
          <View style={styles.timelineTrack}>
            <View style={[styles.timelineSegment, { backgroundColor: '#FF8A00' }]} />
            <View style={[styles.timelineSegment, { backgroundColor: '#43A047' }]} />
            <View style={[styles.timelineSegment, { backgroundColor: '#42A5F5' }]} />
            <View style={styles.timelineThumb} />
          </View>
          <Text style={styles.timelineFuture}>{timeFutureLabel}</Text>
        </View>
      ) : null}

      <View style={styles.watermarkOverlay} pointerEvents="none" accessible={false}>
        <Image source={WATERMARK_LOGO} style={styles.watermarkLogo} resizeMode="contain" />
        <Text style={styles.watermarkText}>{watermarkText}</Text>
      </View>

      <View
        style={[
          styles.watermarkFooter,
          chromeHidden ? styles.watermarkFooterCompact : null,
        ]}
        pointerEvents="none"
        accessible={false}
      >
        <Text
          style={[
            styles.watermarkFooterText,
            chromeHidden ? styles.watermarkFooterTextCompact : null,
          ]}
          numberOfLines={1}
        >
          {watermarkFooter} - {updatedAtFooter}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  badge: {
    position: 'absolute',
    left: 16,
    right: 94,
    top: 82,
    minHeight: 34,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
    flex: 1,
  },
  mapModeBtn: {
    position: 'absolute',
    top: 82,
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(0,0,0,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recenterBtn: {
    position: 'absolute',
    bottom: 300,
    minHeight: 38,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recenterBtnCompact: {
    bottom: 88,
  },
  recenterText: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  userMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.4,
    borderColor: 'rgba(13,71,161,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  userAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  userLogo: {
    width: 18,
    height: 18,
  },
  watermarkOverlay: {
    position: 'absolute',
    left: 22,
    top: '42%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    opacity: ThemeTokens.SecurityMap.watermarkOpacity,
  },
  watermarkLogo: {
    width: 36,
    height: 36,
  },
  watermarkText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
    fontFamily: FONT_FAMILY,
    letterSpacing: -0.6,
  },
  watermarkFooter: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: ThemeTokens.SecurityMap.compactHeight + 8,
    alignItems: 'center',
    opacity: 0.5,
  },
  watermarkFooterCompact: {
    bottom: 12,
    opacity: 0.64,
  },
  watermarkFooterText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  watermarkFooterTextCompact: {
    fontSize: 10,
  },
  sideInsetRight: {
    right: 16,
  },
  sideInsetLeft: {
    left: 16,
  },
  floatingRight: {
    right: 16,
  },
  floatingLeft: {
    left: 16,
  },
  recenterRight: {
    right: 16,
  },
  recenterLeft: {
    left: 16,
  },
  liveBadge: {
    position: 'absolute',
    top: 98,
    minHeight: 28,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(7,14,24,0.62)',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    maxWidth: 130,
  },
  liveBadgeText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  timelineCard: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: ThemeTokens.SecurityMap.compactHeight + 30,
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: 'rgba(7,14,24,0.58)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timelineLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
  timelineNow: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
  timelineTrack: {
    flex: 1,
    height: 8,
    borderRadius: 5,
    overflow: 'hidden',
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.14)',
    position: 'relative',
  },
  timelineSegment: {
    flex: 1,
  },
  timelineThumb: {
    position: 'absolute',
    left: '47%',
    top: -2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.36)',
  },
  timelineFuture: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: FONT_FAMILY,
  },
});

export default SecurityMapView;
