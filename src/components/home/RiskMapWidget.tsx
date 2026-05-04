import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Image,
  Pressable,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import MapLibreGL from '@maplibre/maplibre-react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import {useTranslation} from 'react-i18next';
import {NativeStackNavigationProp} from '@react-navigation/native-stack';

import {useTheme} from '../../context/ThemeContext';
import {useSecurity} from '../../context/SecurityContext';
import {ThemeTokens} from '../../constants/ThemeTokens';
import {TelemetryService} from '../../services/TelemetryService';
import {ProfileService} from '../../services/ProfileService';
import {
  MAP_MAX_ZOOM,
  MAP_STYLE_DEFAULT,
  MAP_STYLE_SAFE_FALLBACK,
  MAP_STYLE_SATELLITE,
  OSM_STYLE_SATELLITE,
  HAS_CONFIGURED_SATELLITE_STYLE,
  MapStyleMode,
} from '../../constants/MapStyles';
import {RootStackParamList} from '../../navigation/types';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const ALERT_LOGO = require('../../assets/logo.png');

const FALLBACK_CENTER: [number, number] = [-40.26, -7.76];

type MapRegionPayload = {
  geometry?: {
    coordinates?: unknown;
  };
  properties?: {
    center?: unknown;
    zoomLevel?: unknown;
    zoom?: unknown;
  };
  centerCoordinate?: unknown;
  zoomLevel?: unknown;
  zoom?: unknown;
};

const getCenterFromPayload = (payload: MapRegionPayload): [number, number] | null => {
  const coords = payload.geometry?.coordinates;
  if (Array.isArray(coords) && coords.length >= 2) {
    return [coords[0], coords[1]];
  }
  const center = payload.properties?.center;
  if (Array.isArray(center) && center.length >= 2) {
    return [center[0], center[1]];
  }
  if (
    Array.isArray(payload.centerCoordinate) &&
    payload.centerCoordinate.length >= 2
  ) {
    return [payload.centerCoordinate[0], payload.centerCoordinate[1]];
  }
  return null;
};

const getZoomFromPayload = (payload: MapRegionPayload): number | null => {
  const candidates = [
    payload.properties?.zoomLevel,
    payload.properties?.zoom,
    payload.zoomLevel,
    payload.zoom,
  ];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }
  return null;
};

const distanceMeters = (
  a: {lat: number; lon: number},
  b: {lat: number; lon: number},
) => {
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

const isValidCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

type Props = {
  navigation: NativeStackNavigationProp<RootStackParamList>;
};

export const RiskMapWidget = React.memo(({navigation}: Props) => {
  const {colors, isDark} = useTheme();
  const {t} = useTranslation();
  const {securityState} = useSecurity();

  const user = securityState.location;
  const hasContextUser =
    isValidCoordinate(user?.latitude) && isValidCoordinate(user?.longitude);
  const activeUser = useMemo(
    () =>
      hasContextUser
        ? {latitude: user.latitude, longitude: user.longitude}
        : null,
    [hasContextUser, user?.latitude, user?.longitude],
  );
  const hasUserLocation = Boolean(activeUser);
  const [cameraCenter, setCameraCenter] =
    useState<[number, number]>(FALLBACK_CENTER);
  const [cameraZoom, setCameraZoom] = useState(15);
  const [showRecenter, setShowRecenter] = useState(false);
  const [isFollowing, setIsFollowing] = useState(true);
  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>('satellite');
  const satelliteStyle = useMemo(
    () =>
      HAS_CONFIGURED_SATELLITE_STYLE
        ? MAP_STYLE_SATELLITE
        : OSM_STYLE_SATELLITE,
    [],
  );
  const preferredMapStyle = useMemo(
    () => (mapStyleMode === 'satellite' ? satelliteStyle : MAP_STYLE_DEFAULT),
    [mapStyleMode, satelliteStyle],
  );
  const [resolvedMapStyle, setResolvedMapStyle] =
    useState<string | object>(preferredMapStyle);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const showMapControls = true;
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);
  const mapStyleToggleLabel =
    mapStyleMode === 'satellite'
      ? t('map_toggle_satellite_off', {
          defaultValue: 'Ativar mapa padrão',
        })
      : t('map_toggle_satellite_on', {
          defaultValue: 'Ativar mapa de satélite',
        });

  useEffect(() => {
    if (!hasUserLocation) {
      setCameraCenter(prev =>
        prev[0] === FALLBACK_CENTER[0] && prev[1] === FALLBACK_CENTER[1]
          ? prev
          : FALLBACK_CENTER,
      );
      if (showRecenter) setShowRecenter(false);
      setIsFollowing(true);
      return;
    }
    if (isFollowing && activeUser) {
      setCameraCenter(prev =>
        prev[0] === activeUser.longitude && prev[1] === activeUser.latitude
          ? prev
          : [activeUser.longitude, activeUser.latitude],
      );
      if (showRecenter) setShowRecenter(false);
    }
  }, [activeUser, hasUserLocation, isFollowing, showRecenter]);

  useEffect(() => {
    setResolvedMapStyle(preferredMapStyle);
    setUsingFallbackStyle(false);
    setMapReady(false);
  }, [preferredMapStyle]);

  useEffect(() => {
    let active = true;
    ProfileService.getProfile()
      .then(profile => {
        if (!active) return;
        const uri =
          typeof profile?.avatarUri === 'string'
            ? profile.avatarUri.trim()
            : '';
        setAvatarUri(uri ? uri : null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = navigation?.addListener?.('focus', () => {
      ProfileService.getProfile()
        .then(profile => {
          const uri =
            typeof profile?.avatarUri === 'string'
              ? profile.avatarUri.trim()
              : '';
          setAvatarUri(uri ? uri : null);
        })
        .catch(() => {});
    });
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [navigation]);

  const toggleMapStyleMode = useCallback(() => {
    setMapStyleMode(prev => {
      return prev === 'satellite' ? 'default' : 'satellite';
    });
  }, []);

  const openSafetyMap = useCallback(() => {
    navigation.navigate('SafetyMap');
  }, [navigation]);

  const handleMapDidFinishLoading = useCallback(() => {
    setMapReady(true);
  }, []);

  const handleMapDidFailLoading = useCallback(() => {
    TelemetryService.trackEvent('risk_map_load_failed', {
      mapStyleMode,
      usingFallbackStyle,
    });
    if (!usingFallbackStyle) {
      setUsingFallbackStyle(true);
      setResolvedMapStyle(MAP_STYLE_SAFE_FALLBACK);
      setMapReady(false);
      return;
    }
    setMapReady(true);
  }, [mapStyleMode, usingFallbackStyle]);

  const handleRegionDidChange = useCallback(
    (payload: MapRegionPayload) => {
      if (!hasUserLocation || !activeUser) return;
      const center = getCenterFromPayload(payload);
      if (center) {
        setCameraCenter(prev =>
          Math.abs(prev[0] - center[0]) < 0.00001 &&
          Math.abs(prev[1] - center[1]) < 0.00001
            ? prev
            : center,
        );
      }
      const zoom = getZoomFromPayload(payload);
      if (typeof zoom === 'number') {
        setCameraZoom(prev => (Math.abs(prev - zoom) < 0.01 ? prev : zoom));
      }
      if (!center) return;
      const dist = distanceMeters(
        {lat: activeUser.latitude, lon: activeUser.longitude},
        {lat: center[1], lon: center[0]},
      );
      const shouldShow = dist > 60;
      if (shouldShow !== showRecenter) {
        setShowRecenter(shouldShow);
      }
      if (shouldShow && isFollowing) {
        setIsFollowing(false);
      }
    },
    [activeUser, hasUserLocation, isFollowing, showRecenter],
  );

  const handleRecenter = useCallback(() => {
    if (!activeUser) return;
    setIsFollowing(true);
    setCameraCenter([activeUser.longitude, activeUser.latitude]);
    const nextZoom = cameraZoom < 15 ? 15 : cameraZoom;
    setCameraZoom(nextZoom);
    cameraRef.current?.setCamera({
      centerCoordinate: [activeUser.longitude, activeUser.latitude],
      zoomLevel: nextZoom,
      animationMode: 'easeTo',
      animationDuration: 350,
    });
    setShowRecenter(false);
  }, [activeUser, cameraZoom]);

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.mapWrap,
          {borderColor: colors.border, backgroundColor: colors.card},
        ]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={t('map_open_label')}
        accessibilityHint={t('map_open_hint')}
        onAccessibilityTap={openSafetyMap}>
        <MapLibreGL.MapView
          style={styles.map}
          mapStyle={resolvedMapStyle}
          scrollEnabled
          zoomEnabled
          rotateEnabled={false}
          pitchEnabled={false}
          compassEnabled={false}
          attributionEnabled={false}
          logoEnabled={false}
          preferredFramesPerSecond={20}
          regionDidChangeDebounceTime={250}
          onDidFinishLoadingMap={handleMapDidFinishLoading}
          onDidFailLoadingMap={handleMapDidFailLoading}
          onRegionDidChange={handleRegionDidChange}
          onPress={openSafetyMap}>
          <MapLibreGL.Camera
            ref={cameraRef}
            zoomLevel={cameraZoom}
            centerCoordinate={cameraCenter}
            animationMode="easeTo"
            animationDuration={0}
            maxZoomLevel={MAP_MAX_ZOOM}
          />

          {activeUser && (
            <MapLibreGL.MarkerView
              id="me"
              coordinate={[activeUser.longitude, activeUser.latitude]}
              anchor={{x: 0.5, y: 0.5}}>
              <View
                style={[
                  styles.markerSelf,
                  {
                    borderColor: colors.primary,
                    backgroundColor: isDark ? 'rgba(7,14,24,0.92)' : '#FFFFFF',
                  },
                ]}>
                {avatarUri ? (
                  <Image
                    source={{uri: avatarUri}}
                    style={styles.markerAvatar}
                  />
                ) : (
                  <Image
                    source={ALERT_LOGO}
                    style={styles.markerLogo}
                    resizeMode="contain"
                  />
                )}
              </View>
            </MapLibreGL.MarkerView>
            )}
          </MapLibreGL.MapView>

        <Pressable
          style={styles.mapTapTarget}
          onPress={openSafetyMap}
          accessibilityRole="button"
          accessibilityLabel={t('map_open_label')}
          accessibilityHint={t('map_open_hint')}
          testID="home-risk-map-open"
        />

        {showMapControls && !hasUserLocation && (
          <View
            style={[
              styles.locationHint,
              {backgroundColor: 'rgba(0,0,0,0.55)'},
            ]}>
            <Icon name="crosshairs-question" size={12} color="#FFFFFF" />
            <Text style={styles.locationHintText}>{t('map_no_location')}</Text>
          </View>
        )}

        {showMapControls ? (
          <TouchableOpacity
            style={[
              styles.mapStyleButton,
              {
                backgroundColor:
                  mapStyleMode === 'satellite'
                    ? colors.primary
                    : 'rgba(18,18,22,0.78)',
                borderColor:
                  mapStyleMode === 'satellite'
                    ? 'rgba(255,255,255,0.28)'
                    : 'rgba(255,255,255,0.22)',
              },
            ]}
            onPress={toggleMapStyleMode}
            activeOpacity={0.88}
            hitSlop={{top: 10, bottom: 10, left: 10, right: 10}}
            accessibilityRole="button"
            accessibilityLabel={mapStyleToggleLabel}>
            <Icon
              name={
                mapStyleMode === 'satellite'
                  ? 'satellite-variant'
                  : 'layers-outline'
              }
              size={16}
              color="#FFFFFF"
            />
          </TouchableOpacity>
        ) : null}

        {showMapControls && hasUserLocation && showRecenter && (
          <TouchableOpacity
            style={[
              styles.recenterButton,
              {
                backgroundColor: isDark ? '#111111' : '#FFFFFF',
                borderColor: isDark
                  ? 'rgba(255,255,255,0.16)'
                  : 'rgba(17,17,17,0.12)',
              },
            ]}
            onPress={handleRecenter}
            activeOpacity={0.9}
            accessibilityRole="button"
            accessibilityLabel={t('recenter')}>
            <Icon
              name="crosshairs-gps"
              size={16}
              color={isDark ? '#FFFFFF' : '#111111'}
            />
            <Text
              style={[
                styles.recenterText,
                {color: isDark ? '#FFFFFF' : '#111111'},
              ]}>
              {t('recenter')}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.xl,
  },
  mapWrap: {
    height: 230,
    width: '100%',
    borderRadius: ThemeTokens.radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  map: {...StyleSheet.absoluteFillObject},
  mapTapTarget: {
    ...StyleSheet.absoluteFillObject,
  },
  markerSelf: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 2,
    borderWidth: 2,
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  markerAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  markerLogo: {
    width: 20,
    height: 20,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  mapStyleButton: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  recenterButton: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: ThemeTokens.radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
    borderWidth: 1,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  recenterText: {fontSize: 12, fontWeight: '700', fontFamily: FONT_FAMILY},
  locationHint: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    height: 30,
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  locationHintText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '700',
    fontFamily: FONT_FAMILY,
  },
});

export default RiskMapWidget;
