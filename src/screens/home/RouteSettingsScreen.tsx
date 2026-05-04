import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert as RNAlert,
  BackHandler,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import MapLibreGL from '@maplibre/maplibre-react-native';
import * as RNLocalize from 'react-native-localize';
import { useTranslation } from 'react-i18next';

import SearchResultsList from '../../components/map/SearchResultsList';
import { ClearDefaultRouteDestinationCommand } from '../../application/commands/ClearDefaultRouteDestinationCommand';
import { SaveDefaultRouteDestinationCommand } from '../../application/commands/SaveDefaultRouteDestinationCommand';
import { SelectRouteDestinationSuggestionCommand } from '../../application/commands/SelectRouteDestinationSuggestionCommand';
import { GetRoutePreviewQuery } from '../../application/queries/GetRoutePreviewQuery';
import { GetRouteSettingsSnapshotQuery } from '../../application/queries/GetRouteSettingsSnapshotQuery';
import { ResolveRouteMapSelectionQuery } from '../../application/queries/ResolveRouteMapSelectionQuery';
import { SearchRouteDestinationQuery } from '../../application/queries/SearchRouteDestinationQuery';
import { ThemeTokens } from '../../constants/ThemeTokens';
import {
  MAP_MAX_ZOOM,
  MAP_STYLE_DEFAULT,
  MAP_STYLE_SAFE_FALLBACK,
} from '../../constants/MapStyles';
import { useSecurity } from '../../context/SecurityContext';
import { useTheme } from '../../context/ThemeContext';
import type {
  DefaultRouteDestination,
  RouteDetails,
  RouteTransportMode,
} from '../../domain/route/RouteModels';
import type { PlaceSuggestion } from '../../domain/maps/MapModels';
import {
  canUseLocationForRiskMaps,
  isFiniteCoordinatePair,
} from '../../utils/locationQuality';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const ALERT_LOGO = require('../../assets/logo.png');
const ROUTE_ESTIMATED_COLOR = ThemeTokens.colors.light.riskMedium;

const TRANSPORT_OPTIONS: Array<{
  mode: RouteTransportMode;
  icon: string;
  a11yKey: string;
}> = [
  {
    mode: 'car',
    icon: 'car',
    a11yKey: 'settings_route_transport_car_a11y',
  },
  {
    mode: 'bus',
    icon: 'bus',
    a11yKey: 'settings_route_transport_bus_a11y',
  },
  {
    mode: 'motorcycle',
    icon: 'motorbike',
    a11yKey: 'settings_route_transport_motorcycle_a11y',
  },
  {
    mode: 'bike',
    icon: 'bike',
    a11yKey: 'settings_route_transport_bike_a11y',
  },
  {
    mode: 'walk',
    icon: 'walk',
    a11yKey: 'settings_route_transport_walk_a11y',
  },
];

const extractPressCoord = (event: any): { latitude: number; longitude: number } | null => {
  const coords =
    event?.geometry?.coordinates ||
    event?.features?.[0]?.geometry?.coordinates ||
    event?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const longitude = Number(coords[0]);
  const latitude = Number(coords[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
};

const buildRouteBounds = (coordinates: Array<[number, number]>) => {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  let minLon = Number(coordinates[0][0]);
  let maxLon = Number(coordinates[0][0]);
  let minLat = Number(coordinates[0][1]);
  let maxLat = Number(coordinates[0][1]);

  coordinates.forEach(item => {
    const lon = Number(item[0]);
    const lat = Number(item[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  });

  return {
    sw: [minLon, minLat] as [number, number],
    ne: [maxLon, maxLat] as [number, number],
  };
};

const formatEtaMinutes = (
  minutes: number,
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  const safeMinutes = Math.max(1, Math.round(Number(minutes || 0)));

  if (safeMinutes >= 60) {
    const hours = Math.floor(safeMinutes / 60);
    const remainder = safeMinutes % 60;
    if (remainder === 0) {
      return t('settings_route_eta_metric_hours_only', { hours });
    }

    return t('settings_route_eta_metric_hours_minutes', { hours, minutes: remainder });
  }

  return t('settings_route_eta_metric_minutes_only', { minutes: safeMinutes });
};

export const RouteSettingsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const { securityState } = useSecurity();
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const user = securityState.location;
  const userLat = typeof user?.latitude === 'number' ? user.latitude : null;
  const userLon = typeof user?.longitude === 'number' ? user.longitude : null;
  const hasUser =
    canUseLocationForRiskMaps(securityState) && isFiniteCoordinatePair(userLat, userLon);

  const [destination, setDestination] = useState<DefaultRouteDestination | null>(null);
  const [label, setLabel] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [transportMode, setTransportMode] = useState<RouteTransportMode>('car');
  const [routeDetails, setRouteDetails] = useState<RouteDetails | null>(null);
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [resolvedMapStyle, setResolvedMapStyle] = useState<any>(MAP_STYLE_DEFAULT);
  const [usingFallbackStyle, setUsingFallbackStyle] = useState(false);
  const cameraRef = useRef<MapLibreGL.CameraRef | null>(null);
  const lastCameraSignatureRef = useRef<string>('');
  const searchRequestIdRef = useRef(0);

  useEffect(() => {
    let active = true;
    GetRouteSettingsSnapshotQuery.execute()
      .then(snapshot => {
        if (!active) return;
        setAvatarUri(snapshot.avatarUri);
        setDestination(snapshot.destination);
        setLabel(snapshot.label);
        setDestinationQuery(snapshot.destinationQuery);
        setTransportMode(snapshot.transportMode);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const hasDestination =
    typeof destination?.latitude === 'number' &&
    Number.isFinite(destination.latitude) &&
    typeof destination?.longitude === 'number' &&
    Number.isFinite(destination.longitude);

  const distanceFormatter = useMemo(
    () =>
      new Intl.NumberFormat(i18n.language, {
        maximumFractionDigits: 1,
      }),
    [i18n.language],
  );
  const searchCountryCode = useMemo(() => {
    const localeCountry = String(RNLocalize.getLocales()?.[0]?.countryCode || '').trim().toUpperCase();
    return localeCountry || undefined;
  }, []);
  const searchResultSections = useMemo(() => {
    if (!searchFocused || searchResults.length === 0) return [];

    const recent = searchResults.filter(item => item.trust?.providerId === 'recent-local');
    const recentIds = new Set(recent.map(item => item.id));

    const nearby = searchResults.filter(item => {
      if (recentIds.has(item.id)) return false;
      return (
        typeof item.distanceMeters === 'number' &&
        Number.isFinite(item.distanceMeters) &&
        item.distanceMeters <= 15000
      );
    });
    const nearbyIds = new Set(nearby.map(item => item.id));

    const suggestions = searchResults.filter(
      item => !recentIds.has(item.id) && !nearbyIds.has(item.id),
    );

    return [
      {
        key: 'nearby',
        title: t('settings_route_search_section_nearby'),
        data: nearby,
      },
      {
        key: 'recent',
        title: t('settings_route_search_section_recent'),
        data: recent,
      },
      {
        key: 'suggestions',
        title: t('settings_route_search_section_suggestions'),
        data: suggestions,
      },
    ].filter(section => section.data.length > 0);
  }, [searchFocused, searchResults, t]);

  const center = useMemo<[number, number]>(() => {
    if (hasDestination) {
      return [destination.longitude, destination.latitude];
    }
    if (hasUser) {
      return [userLon as number, userLat as number];
    }
    return [-46.6333, -23.5505];
  }, [destination, hasDestination, hasUser, userLat, userLon]);

  const routeShape = useMemo(() => {
    const line = routeDetails?.line;
    if (!Array.isArray(line) || line.length < 2) return null;
    return {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: line,
      },
    } as const;
  }, [routeDetails?.line]);
  const routeLineStyle = useMemo(
    () =>
      routeDetails?.routeMode === 'estimated_straight_line'
        ? {
            lineColor: ROUTE_ESTIMATED_COLOR,
            lineWidth: 3,
            lineOpacity: 0.76,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
            lineDasharray: [2, 2],
          }
        : {
            lineColor: colors.primary,
            lineWidth: 4,
            lineOpacity: 0.9,
            lineCap: 'round' as const,
            lineJoin: 'round' as const,
          },
    [colors.primary, routeDetails?.routeMode],
  );

  const cameraCoordinates = useMemo(() => {
    if (Array.isArray(routeDetails?.line) && routeDetails.line.length > 1) {
      return routeDetails.line;
    }
    if (hasDestination && hasUser) {
      return [
        [userLon as number, userLat as number],
        [destination.longitude, destination.latitude],
      ] as Array<[number, number]>;
    }
    if (hasDestination) {
      return [[destination.longitude, destination.latitude]] as Array<[number, number]>;
    }
    if (hasUser) {
      return [[userLon as number, userLat as number]] as Array<[number, number]>;
    }
    return [center];
  }, [center, destination, hasDestination, hasUser, routeDetails?.line, userLat, userLon]);

  const closeRouteSettings = useCallback(() => {
    if (typeof navigation?.canGoBack === 'function' && navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    if (typeof navigation?.reset === 'function') {
      navigation.reset({
        index: 0,
        routes: [{ name: 'Home' }],
      });
      return;
    }

    if (typeof navigation?.navigate === 'function') {
      navigation.navigate('Home');
    }
  }, [navigation]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      closeRouteSettings();
      return true;
    });

    return () => subscription.remove();
  }, [closeRouteSettings]);

  useEffect(() => {
    let cancelled = false;

    const loadRoute = async () => {
      if (!hasUser || !hasDestination) {
        setRouteDetails(null);
        setRouteLoading(false);
        return;
      }

      setRouteLoading(true);
      const details = await GetRoutePreviewQuery.execute({
        from: { latitude: userLat as number, longitude: userLon as number },
        to: { latitude: destination.latitude, longitude: destination.longitude },
        transportMode,
      }).catch(() => null);

      if (!cancelled) {
        setRouteDetails(details);
        setRouteLoading(false);
      }
    };

    void loadRoute();

    return () => {
      cancelled = true;
    };
  }, [destination, hasDestination, hasUser, transportMode, userLat, userLon]);

  useEffect(() => {
    if (!searchFocused) {
      setSearchLoading(false);
      setSearchResults([]);
      return;
    }

    const requestId = searchRequestIdRef.current + 1;
    searchRequestIdRef.current = requestId;
    setSearchLoading(true);
    const trimmedQuery = destinationQuery.trim();

    const timeoutId = setTimeout(() => {
      void SearchRouteDestinationQuery.execute({
        query: trimmedQuery,
        locale: i18n.language,
        near: hasUser ? [userLon as number, userLat as number] : undefined,
        countryCode: searchCountryCode,
      })
        .then(results => {
          if (searchRequestIdRef.current !== requestId) return;
          setSearchResults(results);
        })
        .catch(() => {
          if (searchRequestIdRef.current !== requestId) return;
          setSearchResults([]);
        })
        .finally(() => {
          if (searchRequestIdRef.current !== requestId) return;
          setSearchLoading(false);
        });
    }, trimmedQuery.length < 2 ? 80 : 260);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [destinationQuery, hasUser, i18n.language, searchCountryCode, searchFocused, userLat, userLon]);

  useEffect(() => {
    if (!mapReady || mapFailed) return;
    const camera = cameraRef.current as any;
    if (!camera) return;

    const coords = cameraCoordinates.filter(
      item =>
        Array.isArray(item) &&
        item.length >= 2 &&
        Number.isFinite(item[0]) &&
        Number.isFinite(item[1]),
    );
    if (coords.length === 0) return;

    const signature = `${transportMode}:${coords
      .map(item => `${Number(item[0]).toFixed(4)}:${Number(item[1]).toFixed(4)}`)
      .join('|')}`;
    if (signature === lastCameraSignatureRef.current) return;
    lastCameraSignatureRef.current = signature;

    const bounds = buildRouteBounds(coords);
    if (
      bounds &&
      (Math.abs(bounds.ne[0] - bounds.sw[0]) > 0.0006 ||
        Math.abs(bounds.ne[1] - bounds.sw[1]) > 0.0006) &&
      typeof camera.fitBounds === 'function'
    ) {
      camera.fitBounds(bounds.ne, bounds.sw, [44, 44, 44, 44], 320);
      return;
    }

    const focus = coords[coords.length - 1];
    camera.setCamera?.({
      centerCoordinate: [focus[0], focus[1]],
      zoomLevel: hasDestination ? 13.4 : hasUser ? 12.8 : 11.8,
      animationMode: 'easeTo',
      animationDuration: 280,
      maxZoomLevel: MAP_MAX_ZOOM,
    });
  }, [cameraCoordinates, hasDestination, hasUser, mapFailed, mapReady, transportMode]);

  const handleMapPress = useCallback(
    (event: any) => {
      const coord = extractPressCoord(event);
      if (!coord) return;

      setDestination(prev => ({
        latitude: coord.latitude,
        longitude: coord.longitude,
        label: prev?.label,
        transportMode,
      }));
      setSearchFocused(false);
      setSearchResults([]);

      void ResolveRouteMapSelectionQuery.execute({
        latitude: coord.latitude,
        longitude: coord.longitude,
        locale: i18n.language,
        currentLabel: label,
        transportMode,
      })
        .then(result => {
          setDestination(result.destination);
          setDestinationQuery(result.destinationQuery);
          setLabel(result.resolvedLabel);
        })
        .catch(() => undefined);
    },
    [i18n.language, label, transportMode],
  );

  const handleSelectSearchResult = useCallback(
    (item: PlaceSuggestion) => {
      void SelectRouteDestinationSuggestionCommand.execute({
        suggestion: item,
        currentLabel: label,
        transportMode,
      })
        .then(result => {
          setDestination(result.destination);
          setDestinationQuery(result.destinationQuery);
          setSearchResults([]);
          setSearchFocused(false);
          setLabel(result.resolvedLabel);
        })
        .catch(() => undefined);
    },
    [label, transportMode],
  );

  const handleMapDidFailLoading = useCallback(() => {
    if (!usingFallbackStyle) {
      setUsingFallbackStyle(true);
      setResolvedMapStyle(MAP_STYLE_SAFE_FALLBACK);
      setMapFailed(false);
      return;
    }

    setMapFailed(true);
  }, [usingFallbackStyle]);

  const handleSave = useCallback(async () => {
    if (!hasDestination) {
      RNAlert.alert(t('settings_route_default'), t('route_settings_pick_destination'));
      return;
    }

    try {
      await SaveDefaultRouteDestinationCommand.execute({
        destination,
        label,
        transportMode,
      });
      closeRouteSettings();
    } catch {
      RNAlert.alert(t('common_error'), t('common_try_again'));
    }
  }, [closeRouteSettings, destination, hasDestination, label, t, transportMode]);

  const handleClear = useCallback(async () => {
    try {
      await ClearDefaultRouteDestinationCommand.execute();
      setDestination(null);
      setLabel('');
      setDestinationQuery('');
      setSearchResults([]);
      setSearchFocused(false);
      setTransportMode('car');
      setRouteDetails(null);
      closeRouteSettings();
    } catch {
      RNAlert.alert(t('common_error'), t('common_try_again'));
    }
  }, [closeRouteSettings, t]);

  const etaMetric = routeDetails?.durationMin
    ? routeDetails.routeMode === 'estimated_straight_line'
      ? t('settings_route_eta_metric_approximate', {
          value: formatEtaMinutes(routeDetails.durationMin, t),
          defaultValue: '~{{value}}',
        })
      : formatEtaMinutes(routeDetails.durationMin, t)
    : null;

  const distanceLabel = routeDetails?.distanceKm
    ? t('settings_route_eta_distance', {
        distance: distanceFormatter.format(routeDetails.distanceKm),
        defaultValue: '{{distance}} km',
      })
    : null;

  const selectedModeLabel = t(`settings_route_transport_${transportMode}`, {
    defaultValue: transportMode,
  });
  const isEstimatedRoute = routeDetails?.routeMode === 'estimated_straight_line';
  const isUnavailableRoute = routeDetails?.routeMode === 'unavailable';
  const routeStatus = isEstimatedRoute
    ? {
        title: t('settings_route_status_estimated_title'),
        body: t('settings_route_status_estimated_body'),
        accessibilityLabel: t('settings_route_status_estimated_a11y'),
        icon: 'alert-outline',
        accentColor: ROUTE_ESTIMATED_COLOR,
      }
    : isUnavailableRoute
      ? {
          title: t('settings_route_status_unavailable_title'),
          body: t('settings_route_status_unavailable_body'),
          accessibilityLabel: t('settings_route_status_unavailable_a11y'),
          icon: 'map-marker-off-outline',
          accentColor: colors.textSecondary,
        }
      : null;

  const etaSupportingText = isEstimatedRoute
    ? distanceLabel
      ? t('settings_route_eta_supporting_estimated', {
          distance: distanceLabel,
          mode: selectedModeLabel,
          defaultValue: `${distanceLabel} / ${selectedModeLabel} / estimated line only`,
        })
      : `${selectedModeLabel} / ${t('settings_route_status_estimated_title')}`
    : distanceLabel
      ? `${distanceLabel} / ${selectedModeLabel}`
      : selectedModeLabel;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <TouchableOpacity onPress={closeRouteSettings} style={styles.headerBtn}>
            <Icon name="arrow-left" size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.text }]}>{t('settings_route_default')}</Text>
          <View style={styles.headerBtn} />
        </View>

        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          {t('settings_route_default_hint')}
        </Text>

        <View style={styles.searchSection}>
          <Text style={[styles.label, { color: colors.text }]}>
            {t('settings_route_destination_search_label')}
          </Text>
          <View
            style={[
              styles.searchInputWrap,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <Icon name="magnify" size={20} color={colors.textSecondary} />
            <TextInput
              value={destinationQuery}
              onChangeText={setDestinationQuery}
              onFocus={() => setSearchFocused(true)}
              placeholder={t('settings_route_destination_search_placeholder')}
              placeholderTextColor={colors.textSecondary}
              style={[styles.searchInput, { color: colors.text }]}
              autoCorrect={false}
              autoCapitalize="words"
              returnKeyType="search"
              accessibilityLabel={t('settings_route_destination_search_placeholder')}
            />
            {searchLoading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
          </View>

          {searchFocused ? (
            <View style={styles.searchResultsWrap}>
              {searchLoading ? (
                <View
                  style={[
                    styles.searchLoadingWrap,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ]}
                >
                  <ActivityIndicator size="small" color={colors.primary} />
                </View>
              ) : (
                <SearchResultsList
                  results={searchResults}
                  sections={searchResultSections}
                  locale={i18n.language}
                  onSelect={handleSelectSearchResult}
                />
              )}
            </View>
          ) : null}
        </View>

        <View style={[styles.mapWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {hasUser ? (
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
              preferredFramesPerSecond={45}
              regionDidChangeDebounceTime={180}
              onDidFinishLoadingMap={() => {
                setMapReady(true);
                setMapFailed(false);
              }}
              onDidFailLoadingMap={handleMapDidFailLoading}
              onPress={handleMapPress}
            >
              <MapLibreGL.Camera
                ref={cameraRef}
                zoomLevel={13}
                centerCoordinate={center}
                animationDuration={0}
                maxZoomLevel={MAP_MAX_ZOOM}
              />

              {routeShape ? (
                <MapLibreGL.ShapeSource id="route-settings-line" shape={routeShape as any}>
                  <MapLibreGL.LineLayer
                    id="route-settings-line-layer"
                    style={routeLineStyle}
                  />
                </MapLibreGL.ShapeSource>
              ) : null}

              <MapLibreGL.PointAnnotation id="me" coordinate={[userLon as number, userLat as number]}>
                <View
                  style={[
                    styles.markerSelf,
                    {
                      borderColor: colors.primary,
                      backgroundColor: colors.background,
                    },
                  ]}>
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={styles.markerAvatar} />
                  ) : (
                    <Image source={ALERT_LOGO} style={styles.markerLogo} resizeMode="contain" />
                  )}
                </View>
              </MapLibreGL.PointAnnotation>

              {hasDestination ? (
                <MapLibreGL.PointAnnotation
                  id="dest"
                  coordinate={[destination.longitude, destination.latitude]}
                >
                  <View style={[styles.markerDest, { borderColor: colors.alert }]}>
                    <Icon name="map-marker" size={22} color={colors.alert} />
                  </View>
                </MapLibreGL.PointAnnotation>
              ) : null}
            </MapLibreGL.MapView>
          ) : (
            <View style={styles.mapEmpty}>
              <Icon name="map-marker-off" size={26} color={colors.textSecondary} />
              <Text style={[styles.mapEmptyText, { color: colors.textSecondary }]}>
                {t('map_no_location')}
              </Text>
            </View>
          )}

          {hasUser && mapFailed ? (
            <View style={[styles.mapUnavailableBadge, { backgroundColor: colors.card }]}>
              <Icon name="map-search-outline" size={14} color={colors.textSecondary} />
              <Text style={[styles.mapUnavailableText, { color: colors.textSecondary }]}>
                {t('map_unavailable')}
              </Text>
            </View>
          ) : null}
        </View>

        {routeStatus ? (
          <View
            style={[
              styles.routeStatusCard,
              {
                backgroundColor: colors.card,
                borderColor: routeStatus.accentColor,
              },
            ]}
            accessible
            accessibilityRole="alert"
            accessibilityLabel={routeStatus.accessibilityLabel}
            accessibilityLiveRegion="polite"
            importantForAccessibility="yes"
          >
            <View style={styles.routeStatusHeader}>
              <Icon name={routeStatus.icon} size={18} color={routeStatus.accentColor} />
              <Text style={[styles.routeStatusTitle, { color: colors.text }]}>
                {routeStatus.title}
              </Text>
            </View>
            <Text style={[styles.routeStatusBody, { color: colors.textSecondary }]}>
              {routeStatus.body}
            </Text>
          </View>
        ) : null}

        <View style={styles.form}>
          <Text style={[styles.label, { color: colors.text }]}>{t('settings_route_label')}</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            placeholder={t('settings_route_label_placeholder')}
            placeholderTextColor={colors.textSecondary}
            style={[
              styles.input,
              { backgroundColor: colors.card, borderColor: colors.border, color: colors.text },
            ]}
          />

          <View style={[styles.etaCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.etaHeader}>
              <Text style={[styles.etaTitle, { color: colors.text }]}>
                {t('settings_route_eta_title')}
              </Text>
              <Text style={[styles.etaHint, { color: colors.textSecondary }]}>
                {t('settings_route_eta_hint')}
              </Text>
            </View>

            {routeLoading ? (
              <View style={styles.etaLoadingWrap}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : etaMetric ? (
              <>
                <Text
                  style={[
                    styles.etaMetric,
                    { color: isEstimatedRoute ? ROUTE_ESTIMATED_COLOR : colors.text },
                  ]}
                >
                  {etaMetric}
                </Text>
                <Text style={[styles.etaMeta, { color: colors.textSecondary }]}>{etaSupportingText}</Text>
              </>
            ) : (
              <Text style={[styles.etaMeta, { color: colors.textSecondary }]}>
                {hasUser && hasDestination
                  ? t('settings_route_status_unavailable_body')
                  : hasUser
                  ? t('settings_route_eta_unavailable')
                  : t('settings_route_eta_no_location')}
              </Text>
            )}
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.primary }]}
              onPress={handleSave}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryText}>{t('common_save')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: colors.border, backgroundColor: colors.card }]}
              onPress={handleClear}
              activeOpacity={0.85}
            >
              <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>
                {t('common_remove')}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.transportSection}>
            <View style={styles.transportRow}>
              {TRANSPORT_OPTIONS.map(option => {
                const active = transportMode === option.mode;
                return (
                  <TouchableOpacity
                    key={option.mode}
                    onPress={() => setTransportMode(option.mode)}
                    style={[
                      styles.transportButton,
                      {
                        backgroundColor: active ? colors.primary : colors.card,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={t(option.a11yKey)}
                    accessibilityState={{ selected: active }}
                  >
                    <Icon name={option.icon} size={24} color={active ? '#FFFFFF' : colors.text} />
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: ThemeTokens.spacing.lg },
  scrollContent: { paddingBottom: ThemeTokens.spacing.xl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
  },
  headerBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  title: {
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  subtitle: {
    marginBottom: ThemeTokens.spacing.md,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  searchSection: {
    marginBottom: ThemeTokens.spacing.md,
  },
  searchInputWrap: {
    minHeight: 52,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  searchInput: {
    flex: 1,
    minHeight: 50,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  searchResultsWrap: {
    marginTop: ThemeTokens.spacing.sm,
  },
  searchLoadingWrap: {
    minHeight: 76,
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapWrap: {
    height: 260,
    borderRadius: ThemeTokens.radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
  },
  map: { ...StyleSheet.absoluteFillObject },
  mapEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  mapEmptyText: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  mapUnavailableBadge: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: 12,
    minHeight: 34,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mapUnavailableText: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontFamily: FONT_FAMILY,
    flex: 1,
  },
  routeStatusCard: {
    marginTop: ThemeTokens.spacing.md,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
    gap: 6,
  },
  routeStatusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  routeStatusTitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
    flex: 1,
  },
  routeStatusBody: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  markerSelf: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 2,
    borderWidth: 2,
  },
  markerAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  markerLogo: {
    width: 18,
    height: 18,
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  markerDest: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 2,
    borderWidth: 2,
  },
  form: { marginTop: ThemeTokens.spacing.lg, paddingBottom: ThemeTokens.spacing.lg },
  label: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    marginBottom: 8,
    fontFamily: FONT_FAMILY,
  },
  input: {
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  etaCard: {
    marginTop: ThemeTokens.spacing.md,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.xl,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
    gap: 6,
  },
  etaHeader: { gap: 4 },
  etaTitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  etaHint: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  etaMetric: {
    fontSize: ThemeTokens.typography.sizes.emergency,
    lineHeight: ThemeTokens.typography.lineHeights.emergency,
    letterSpacing: ThemeTokens.typography.letterSpacing.emergency,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  etaMeta: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  etaLoadingWrap: {
    minHeight: 48,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: ThemeTokens.spacing.md },
  primaryBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#FFF',
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  secondaryBtn: {
    width: 120,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  transportSection: { marginTop: ThemeTokens.spacing.md },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  transportButton: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
