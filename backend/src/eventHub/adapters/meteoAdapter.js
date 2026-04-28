const { fetchJsonWithRetry } = require('../fetcher');
const { bboxFromPoint, createUnifiedEvent, nowIso, toIso } = require('../utils');

const GDACS_EVENTS4APP_URL =
  'https://www.gdacs.org/gdacsapi/api/events/geteventlist/events4app';
const GDACS_ALLOWED_EVENT_TYPES = new Set(['FL', 'TC', 'WF', 'VO', 'TS', 'DR']);
const GDACS_LOOKBACK_DAYS = 60;
const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';
const WEATHER_NOWCAST_REFERENCE_URL = 'https://open-meteo.com/';
const NOWCAST_EVENT_RADIUS_KM = 12;

const levelToSeverity = level => {
  const normalized = String(level || '').toLowerCase();
  if (normalized.includes('red')) return 'Extreme';
  if (normalized.includes('orange')) return 'Severe';
  if (normalized.includes('green')) return 'Moderate';
  return 'Minor';
};

const levelToConfidence = level => {
  const normalized = String(level || '').toLowerCase();
  if (normalized.includes('red')) return 0.9;
  if (normalized.includes('orange')) return 0.78;
  if (normalized.includes('green')) return 0.6;
  return 0.45;
};

const gdacsTypeToCategories = (eventType, title) => {
  const type = String(eventType || '').trim().toUpperCase();
  const text = String(title || '').toLowerCase();
  if (type === 'FL') return ['flood', 'high_tide'];
  if (type === 'TC') return ['cyclone', 'hurricane', 'wind_gust_10', 'wind_gust_50'];
  if (type === 'WF') return ['wildfire'];
  if (type === 'VO') return ['volcano', 'volcanic_cloud'];
  if (type === 'TS') return ['tsunami', 'rogue_waves'];
  if (type === 'DR') return ['drought', 'heatwave'];

  if (text.includes('sand') || text.includes('dust')) return ['sandstorm', 'dust_devils'];
  if (text.includes('hail')) return ['hail'];
  if (text.includes('snow')) return ['snowstorm'];
  if (text.includes('lightning')) return ['lightning', 'storm'];
  if (text.includes('wind') || text.includes('gale')) return ['wind', 'wind_gust_10', 'wind_gust_50'];
  if (text.includes('storm') || text.includes('thunder')) return ['storm'];
  if (text.includes('heat')) return ['heatwave', 'heat'];
  if (text.includes('flood')) return ['flood'];

  return ['storm'];
};

const readGdacsTimestampMs = value => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
};

const includeGdacsItem = (item, now = new Date()) => {
  const props = item?.properties || item || {};
  const eventType = String(props.eventtype || props.type || '')
    .trim()
    .toUpperCase();
  if (!GDACS_ALLOWED_EVENT_TYPES.has(eventType)) {
    return false;
  }

  const endDateMs = readGdacsTimestampMs(props.todate || props.eventdate || props.fromdate);
  if (!Number.isFinite(endDateMs)) {
    return false;
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(String(now || ''));
  const lookbackMs = GDACS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  return endDateMs >= nowMs - lookbackMs;
};

const resolveGdacsReferenceUrl = props => {
  if (typeof props?.url === 'string' && props.url.trim()) {
    return props.url.trim();
  }
  if (props?.url && typeof props.url === 'object') {
    return String(
      props.url.report || props.url.details || props.url.geometry || 'https://www.gdacs.org',
    ).trim();
  }
  return 'https://www.gdacs.org';
};

const createGdacsEventsForItem = (item, provider) => {
  const props = item?.properties || item || {};
  const geometry = item?.geometry;
  const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
  const lon = Number(props.lon ?? coords?.[0]);
  const lat = Number(props.lat ?? coords?.[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const gdacsType = String(props.eventtype || props.type || '').toUpperCase();
  const title = String(
    props.eventname || props.name || props.title || props.description || 'Global hazard alert',
  );
  const severity = levelToSeverity(props.alertlevel);
  const confidence = levelToConfidence(props.alertlevel);
  const categories = gdacsTypeToCategories(gdacsType, title);
  const eventId = String(props.eventid || props.id || `${gdacsType}-${lat}-${lon}`);
  const updatedAt =
    toIso(props.todate || props.eventdate || props.fromdate || props.lastupdate) || nowIso();
  const startTime = toIso(props.fromdate || props.eventdate || updatedAt) || updatedAt;
  const referenceUrl = resolveGdacsReferenceUrl(props);
  const country = String(props.country || props.iso3 || '').toUpperCase() || null;

  return categories.map((category, idx) =>
    createUnifiedEvent({
      id: `${eventId}:${category}:${idx}`,
      type: category,
      subtype: gdacsType || category,
      severity,
      urgency: severity === 'Extreme' ? 'Immediate' : 'Expected',
      certainty: severity === 'Extreme' ? 'Observed' : 'Likely',
      confidence,
      startTime,
      updatedAt,
      geometry: { type: 'point', coordinates: [lon, lat] },
      region: {
        country,
        admin1: String(props.province || props.region || '') || null,
        city: String(props.place || props.name || '') || null,
      },
      source: {
        name: 'GDACS',
        trustTier: provider.trustTier,
        sourceClass: provider.sourceClass,
        sourceAuthority: provider.sourceAuthority,
        providerId: provider.id,
        referenceUrl,
      },
      recommendedActions: [
        'Follow official civil defense guidance.',
        'Avoid exposed routes and monitor route changes.',
      ],
      privacyLevel: 'public',
    }),
  );
};

const bboxCenter = bbox => {
  if (
    !bbox ||
    !Number.isFinite(Number(bbox.minLat)) ||
    !Number.isFinite(Number(bbox.minLon)) ||
    !Number.isFinite(Number(bbox.maxLat)) ||
    !Number.isFinite(Number(bbox.maxLon))
  ) {
    return null;
  }

  return {
    latitude: (Number(bbox.minLat) + Number(bbox.maxLat)) / 2,
    longitude: (Number(bbox.minLon) + Number(bbox.maxLon)) / 2,
  };
};

const mapNowcastSeverity = ({ weatherCode, precipitation, gusts, eventType }) => {
  if (eventType === 'lightning') return 'Severe';
  if (eventType === 'hail') return weatherCode === 99 ? 'Extreme' : 'Severe';
  if (eventType === 'flood') return precipitation >= 18 ? 'Extreme' : 'Severe';
  if (eventType === 'snowstorm') return precipitation >= 8 || gusts >= 50 ? 'Severe' : 'Moderate';
  if (weatherCode === 99 || gusts >= 72 || precipitation >= 14) return 'Extreme';
  if (weatherCode === 95 || gusts >= 56 || precipitation >= 8) return 'Severe';
  return 'Moderate';
};

const mapNowcastConfidence = ({ source, weatherCode, precipitation }) => {
  if (source === 'current') {
    if (weatherCode === 99 || precipitation >= 12) return 0.94;
    if (weatherCode === 95 || precipitation >= 6) return 0.9;
    return 0.86;
  }
  if (weatherCode === 99 || precipitation >= 10) return 0.82;
  if (weatherCode === 95 || precipitation >= 5) return 0.76;
  return 0.7;
};

const inferNowcastEventTypes = ({ weatherCode, precipitation, rain, showers, snowfall, gusts }) => {
  const eventTypes = [];
  const code = Number(weatherCode || 0);
  const mm = Math.max(0, Number(precipitation || 0));
  const rainNow = Math.max(0, Number(rain || 0));
  const showersNow = Math.max(0, Number(showers || 0));
  const snowNow = Math.max(0, Number(snowfall || 0));
  const gust = Math.max(0, Number(gusts || 0));

  if (code === 96 || code === 99) {
    eventTypes.push('hail');
  }
  if (code === 95 || code === 96 || code === 99) {
    eventTypes.push('lightning');
    eventTypes.push('storm');
  }
  if ([71, 73, 75, 77, 85, 86].includes(code) || snowNow >= 1.5) {
    eventTypes.push('snowstorm');
  }
  if (mm >= 12 || rainNow >= 8 || showersNow >= 8 || (mm >= 8 && gust >= 50)) {
    eventTypes.push('flood');
  }
  if ((mm >= 5 || rainNow >= 4 || showersNow >= 4 || gust >= 46) && !eventTypes.includes('storm')) {
    eventTypes.push('storm');
  }

  return Array.from(new Set(eventTypes));
};

const createNowcastEvent = ({
  eventType,
  provider,
  lat,
  lon,
  region,
  source,
  validAt,
  confidence,
  weatherCode,
  precipitation,
  gusts,
}) =>
  createUnifiedEvent({
    id: `${provider.id}:${eventType}:${source}:${lat.toFixed(3)}:${lon.toFixed(3)}:${validAt}`,
    type: eventType,
    subtype: `openmeteo_nowcast_${eventType}`,
    severity: mapNowcastSeverity({ weatherCode, precipitation, gusts, eventType }),
    urgency: source === 'current' ? 'Immediate' : 'Expected',
    certainty: source === 'current' ? 'Observed' : 'Likely',
    confidence,
    startTime: validAt,
    endTime:
      source === 'current'
        ? new Date(new Date(validAt).getTime() + 30 * 60 * 1000).toISOString()
        : new Date(new Date(validAt).getTime() + 90 * 60 * 1000).toISOString(),
    updatedAt: validAt,
    geometry: { type: 'point', coordinates: [lon, lat] },
    bbox: bboxFromPoint(lat, lon, NOWCAST_EVENT_RADIUS_KM),
    region,
    source: {
      name: 'Open-Meteo Nowcast',
      trustTier: provider.trustTier,
      sourceClass: provider.sourceClass,
      sourceAuthority: provider.sourceAuthority,
      providerId: provider.id,
      referenceUrl: WEATHER_NOWCAST_REFERENCE_URL,
    },
    recommendedActions: [
      'Monitor local changes in weather and avoid exposed routes.',
      'Seek shelter if lightning or severe precipitation intensifies.',
    ],
    privacyLevel: 'public',
  });

const createNowcastEvents = ({ json, provider, bbox }) => {
  const center = bboxCenter(bbox);
  if (!center) return [];
  const lat = center.latitude;
  const lon = center.longitude;
  const region = {
    country: null,
    admin1: null,
    city: null,
  };

  const events = [];
  const current = json?.current || {};
  const currentWeatherCode = Number(current?.weather_code || 0);
  const currentPrecipitation = Number(current?.precipitation || 0);
  const currentRain = Number(current?.rain || 0);
  const currentShowers = Number(current?.showers || 0);
  const currentSnowfall = Number(current?.snowfall || 0);
  const currentGusts = Number(current?.wind_gusts_10m || 0);
  const currentTime = toIso(current?.time) || nowIso();

  const currentEventTypes = inferNowcastEventTypes({
    weatherCode: currentWeatherCode,
    precipitation: currentPrecipitation,
    rain: currentRain,
    showers: currentShowers,
    snowfall: currentSnowfall,
    gusts: currentGusts,
  });

  currentEventTypes.forEach(eventType => {
    events.push(
      createNowcastEvent({
        eventType,
        provider,
        lat,
        lon,
        region,
        source: 'current',
        validAt: currentTime,
        confidence: mapNowcastConfidence({
          source: 'current',
          weatherCode: currentWeatherCode,
          precipitation: currentPrecipitation,
        }),
        weatherCode: currentWeatherCode,
        precipitation: currentPrecipitation,
        gusts: currentGusts,
      }),
    );
  });

  const minutely15 = json?.minutely_15 || {};
  const minutelyTimes = Array.isArray(minutely15?.time) ? minutely15.time : [];
  const minutelyWeatherCodes = Array.isArray(minutely15?.weather_code) ? minutely15.weather_code : [];
  const minutelyPrecipitations = Array.isArray(minutely15?.precipitation)
    ? minutely15.precipitation
    : [];

  for (let index = 0; index < Math.min(minutelyTimes.length, 4); index += 1) {
    const validAt = toIso(minutelyTimes[index]);
    if (!validAt) continue;

    const weatherCode = Number(minutelyWeatherCodes[index] || 0);
    const precipitation = Number(minutelyPrecipitations[index] || 0);
    const eventTypes = inferNowcastEventTypes({
      weatherCode,
      precipitation,
      rain: precipitation,
      showers: precipitation,
      snowfall: 0,
      gusts: currentGusts,
    });

    eventTypes.forEach(eventType => {
      events.push(
        createNowcastEvent({
          eventType,
          provider,
          lat,
          lon,
          region,
          source: 'forecast',
          validAt,
          confidence: Math.max(
            0.78,
            mapNowcastConfidence({
              source: 'forecast',
              weatherCode,
              precipitation,
            }),
          ),
          weatherCode,
          precipitation,
          gusts: currentGusts,
        }),
      );
    });
  }

  const hourly = json?.hourly || {};
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const weatherCodes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const precipitations = Array.isArray(hourly?.precipitation) ? hourly.precipitation : [];
  const rains = Array.isArray(hourly?.rain) ? hourly.rain : [];
  const showers = Array.isArray(hourly?.showers) ? hourly.showers : [];
  const snowfalls = Array.isArray(hourly?.snowfall) ? hourly.snowfall : [];
  const gusts = Array.isArray(hourly?.wind_gusts_10m) ? hourly.wind_gusts_10m : [];

  for (let index = 0; index < Math.min(times.length, 6); index += 1) {
    const validAt = toIso(times[index]);
    if (!validAt) continue;
    const weatherCode = Number(weatherCodes[index] || 0);
    const precipitation = Number(precipitations[index] || 0);
    const eventTypes = inferNowcastEventTypes({
      weatherCode,
      precipitation,
      rain: Number(rains[index] || 0),
      showers: Number(showers[index] || 0),
      snowfall: Number(snowfalls[index] || 0),
      gusts: Number(gusts[index] || 0),
    });

    eventTypes.forEach(eventType => {
      events.push(
        createNowcastEvent({
          eventType,
          provider,
          lat,
          lon,
          region,
          source: 'forecast',
          validAt,
          confidence: mapNowcastConfidence({
            source: 'forecast',
            weatherCode,
            precipitation,
          }),
          weatherCode,
          precipitation,
          gusts: Number(gusts[index] || 0),
        }),
      );
    });
  }

  return events;
};

const fetchMeteoGdacsEvents = async ({ provider }) => {
  const startedAt = Date.now();
  const result = await fetchJsonWithRetry(GDACS_EVENTS4APP_URL, {
    cacheKey: 'gdacs:events4app',
    cacheTtlMs: provider.cacheTTLms,
    retries: 0,
    retryDelayMs: 260,
    timeoutMs: provider.latencyBudgetMs || 1500,
    rateLimitKey: provider.id,
    maxPerMinute: 45,
  });

  if (!result.ok) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: result.error || 'gdacs_unavailable',
      },
    };
  }

  const rows = (Array.isArray(result.json?.features)
    ? result.json.features
    : Array.isArray(result.json?.events)
      ? result.json.events
      : Array.isArray(result.json?.result)
        ? result.json.result
        : [])
    .filter(item => includeGdacsItem(item, new Date()));

  const events = rows.flatMap(item => createGdacsEventsForItem(item, provider));

  return {
    events,
    status: {
      providerId: provider.id,
      adapterName: provider.adapterName,
      primaryProvider: provider.primaryProvider,
      fallbackProvider: provider.fallbackProvider,
      trustTier: provider.trustTier,
      coverage: provider.coverage,
      latencyBudgetMs: provider.latencyBudgetMs,
      updateCadence: provider.updateCadence,
      cacheTTLms: provider.cacheTTLms,
      lastFetchAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      ok: true,
      stale: false,
      status: 'online',
      eventCount: events.length,
      cacheHit: Boolean(result.cached),
    },
  };
};

const fetchMeteoNowcastEvents = async ({ provider, bbox }) => {
  const startedAt = Date.now();
  const center = bboxCenter(bbox);
  if (!center) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: 'bbox_required_for_nowcast',
      },
    };
  }

  const url =
    `${OPEN_METEO_URL}?latitude=${center.latitude.toFixed(4)}` +
    `&longitude=${center.longitude.toFixed(4)}` +
    '&current=weather_code,precipitation,rain,showers,snowfall,wind_speed_10m,wind_gusts_10m' +
    '&minutely_15=weather_code,precipitation' +
    '&hourly=weather_code,precipitation,rain,showers,snowfall,wind_speed_10m,wind_gusts_10m' +
    '&forecast_hours=6&timezone=UTC';

  const result = await fetchJsonWithRetry(url, {
    cacheKey: `openmeteo-nowcast:${center.latitude.toFixed(3)}:${center.longitude.toFixed(3)}`,
    cacheTtlMs: provider.cacheTTLms,
    retries: 1,
    retryDelayMs: 220,
    timeoutMs: provider.latencyBudgetMs || 1200,
    rateLimitKey: provider.id,
    maxPerMinute: 60,
  });

  if (!result.ok) {
    return {
      events: [],
      status: {
        providerId: provider.id,
        adapterName: provider.adapterName,
        primaryProvider: provider.primaryProvider,
        fallbackProvider: provider.fallbackProvider,
        trustTier: provider.trustTier,
        coverage: provider.coverage,
        latencyBudgetMs: provider.latencyBudgetMs,
        updateCadence: provider.updateCadence,
        cacheTTLms: provider.cacheTTLms,
        lastFetchAt: nowIso(),
        latencyMs: Date.now() - startedAt,
        ok: false,
        stale: true,
        status: 'offline',
        reason: result.error || 'nowcast_unavailable',
      },
    };
  }

  const events = createNowcastEvents({
    json: result.json,
    provider,
    bbox,
  });

  return {
    events,
    status: {
      providerId: provider.id,
      adapterName: provider.adapterName,
      primaryProvider: provider.primaryProvider,
      fallbackProvider: provider.fallbackProvider,
      trustTier: provider.trustTier,
      coverage: provider.coverage,
      latencyBudgetMs: provider.latencyBudgetMs,
      updateCadence: provider.updateCadence,
      cacheTTLms: provider.cacheTTLms,
      lastFetchAt: nowIso(),
      latencyMs: Date.now() - startedAt,
      ok: true,
      stale: false,
      status: 'online',
      eventCount: events.length,
      cacheHit: Boolean(result.cached),
    },
  };
};

module.exports = {
  fetchMeteoGdacsEvents,
  fetchMeteoNowcastEvents,
  __test__: {
    createGdacsEventsForItem,
    includeGdacsItem,
    createNowcastEvents,
    inferNowcastEventTypes,
    mapNowcastSeverity,
    mapNowcastConfidence,
  },
};
