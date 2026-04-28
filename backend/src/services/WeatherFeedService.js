const {
  fetchWeatherFeedOpenMeteo,
} = require('../eventHub/adapters/weatherFeedOpenMeteoAdapter');
const { nowIso } = require('../eventHub/utils');

const isFiniteNumber = value =>
  typeof value === 'number' && Number.isFinite(value);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const pickFirst = (...values) =>
  values.find(
    value => typeof value === 'string' && value.trim().length > 0,
  ) || '';

const mapWmoToIcon = (code, isDay) => {
  const safeCode = Number(code || 0);
  if (safeCode === 0) {
    return {
      icon: isDay ? 'weather-sunny' : 'weather-night',
      labelKey: isDay ? 'weather_clear_sky_day' : 'weather_clear_sky_night',
    };
  }
  if ([1, 2].includes(safeCode)) {
    return {
      icon: isDay ? 'weather-partly-cloudy' : 'weather-night-partly-cloudy',
      labelKey: 'weather_partly_cloudy',
    };
  }
  if (safeCode === 3) {
    return { icon: 'weather-cloudy', labelKey: 'weather_overcast' };
  }
  if ([45, 48].includes(safeCode)) {
    return { icon: 'weather-fog', labelKey: 'weather_fog' };
  }
  if (safeCode >= 51 && safeCode <= 67) {
    return { icon: 'weather-rainy', labelKey: 'weather_rain' };
  }
  if (safeCode >= 71 && safeCode <= 77) {
    return { icon: 'weather-snowy', labelKey: 'weather_snow' };
  }
  if (safeCode === 79) {
    return { icon: 'weather-hail', labelKey: 'weather_hail' };
  }
  if (safeCode >= 80 && safeCode <= 82) {
    return { icon: 'weather-pouring', labelKey: 'weather_showers' };
  }
  if (safeCode >= 85 && safeCode <= 86) {
    return { icon: 'weather-snowy-heavy', labelKey: 'weather_snow_showers' };
  }
  if (safeCode === 95) {
    return {
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_thunder',
    };
  }
  if (safeCode >= 96 && safeCode <= 99) {
    return {
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_hail',
    };
  }
  return { icon: 'weather-cloudy', labelKey: 'weather_overcast' };
};

const resolveCityFromReverse = reverseData => {
  if (reverseData && typeof reverseData === 'object') {
    const direct = pickFirst(
      reverseData.city,
      reverseData.locality,
      reverseData.principalSubdivision,
      reverseData.countryName,
    );
    if (direct) {
      return direct;
    }
  }

  const result = Array.isArray(reverseData?.results)
    ? reverseData.results[0]
    : null;
  if (result) {
    return pickFirst(
      result?.name,
      result?.locality,
      result?.admin2,
      result?.admin1,
      result?.country,
    );
  }

  const address = reverseData?.address || {};
  return pickFirst(
    address.city,
    address.town,
    address.village,
    address.hamlet,
    address.municipality,
    address.county,
    address.city_district,
    address.suburb,
    address.neighbourhood,
    reverseData?.name,
    address.state,
    address.country,
  );
};

const buildIntelligenceSignal = weatherData => {
  const current = weatherData?.current || {};
  const hourly = weatherData?.hourly || {};
  const weatherCode = Number(current?.weather_code || 0);
  const precipitation = Number(current?.precipitation || 0);
  const rain = Number(current?.rain || 0);
  const showers = Number(current?.showers || 0);
  const snowfall = Number(current?.snowfall || 0);
  const liquid = Math.max(precipitation, rain, showers);

  if (weatherCode >= 96 && weatherCode <= 99) {
    return {
      kind: 'hail',
      icon: 'weather-hail',
      labelKey: 'weather_signal_hail',
      confidence: 0.94,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if (weatherCode === 95) {
    return {
      kind: 'thunder',
      icon: 'weather-lightning-rainy',
      labelKey: 'weather_signal_thunder',
      confidence: 0.92,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if ((weatherCode >= 71 && weatherCode <= 77) || snowfall >= 0.2) {
    return {
      kind: 'snow',
      icon: 'weather-snowy',
      labelKey: 'weather_signal_snow',
      confidence: 0.9,
      startsInMinutes: 0,
      source: 'current',
    };
  }
  if ((weatherCode >= 51 && weatherCode <= 82) || liquid >= 0.2) {
    return {
      kind: 'rain',
      icon: liquid >= 1.2 ? 'weather-pouring' : 'weather-rainy',
      labelKey: 'weather_signal_rain',
      confidence: liquid >= 1 ? 0.9 : 0.78,
      startsInMinutes: 0,
      source: 'current',
    };
  }

  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const rainProbability = Array.isArray(hourly?.precipitation_probability)
    ? hourly.precipitation_probability
    : [];
  const now = Date.now();

  for (let index = 0; index < Math.min(times.length, 6); index += 1) {
    const startsAt = Date.parse(times[index]);
    if (!Number.isFinite(startsAt)) continue;
    const startsInMinutes = Math.max(0, Math.round((startsAt - now) / 60000));
    if (startsInMinutes > 180) continue;
    const code = Number(codes[index] || 0);
    const probability = Number(rainProbability[index] || 0);
    if (code >= 96 && code <= 99) {
      return {
        kind: 'hail',
        icon: 'weather-hail',
        labelKey: 'weather_signal_hail',
        confidence: 0.82,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if (code === 95) {
      return {
        kind: 'lightning',
        icon: 'weather-lightning-rainy',
        labelKey: 'weather_signal_lightning',
        confidence: 0.8,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if ((code >= 71 && code <= 86) || probability >= 75) {
      return {
        kind: 'snow',
        icon: 'weather-snowy',
        labelKey: 'weather_signal_snow',
        confidence: 0.76,
        startsInMinutes,
        source: 'forecast',
      };
    }
    if ((code >= 51 && code <= 82) || probability >= 58) {
      return {
        kind: 'rain',
        icon: 'weather-rainy',
        labelKey: 'weather_signal_rain',
        confidence: 0.74,
        startsInMinutes,
        source: 'forecast',
      };
    }
  }

  return null;
};

const buildUnavailableWeatherFeed = (lat, lon) => ({
  available: false,
  location: {
    city: '',
    latitude: lat,
    longitude: lon,
    timezone: 'UTC',
  },
  current: null,
  daily: {
    forecastDays: [],
    sunrise: '',
    sunset: '',
  },
  intelligenceSignal: null,
  freshness: {
    fetchedAt: nowIso(),
    cacheTtlSec: 60,
    status: 'UNKNOWN',
  },
});

const getWeatherFeed = async (
  { latitude, longitude, locale },
  { config } = {},
) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return buildUnavailableWeatherFeed(lat, lon);
  }

  const safeLocale = String(locale || 'en').trim() || 'en';
  const { forecastResult: weatherResult, reverseResult } =
    await fetchWeatherFeedOpenMeteo(
      {
        latitude: lat,
        longitude: lon,
        locale: safeLocale,
      },
      {
        userAgent: config?.weather?.userAgent,
      },
    );

  if (!weatherResult.ok || !weatherResult.json) {
    return buildUnavailableWeatherFeed(lat, lon);
  }

  const weatherData = weatherResult.json;
  const city = reverseResult.ok ? resolveCityFromReverse(reverseResult.json) : '';
  const current = weatherData?.current || {};
  const daily = weatherData?.daily || {};
  const currentCode = Number(current?.weather_code || 0);
  const isDay = current?.is_day === 1 || current?.is_day === true;
  const currentVisual = mapWmoToIcon(currentCode, isDay);
  const forecastDays = Array.isArray(daily?.time)
    ? daily.time.slice(1, 4).map((dateValue, index) => {
        const dataIndex = index + 1;
        const weatherCode = Number(daily?.weather_code?.[dataIndex] || 0);
        return {
          date: String(dateValue || ''),
          weatherCode,
          icon: mapWmoToIcon(weatherCode, true).icon,
          labelKey: mapWmoToIcon(weatherCode, true).labelKey,
          maxTempC: isFiniteNumber(daily?.temperature_2m_max?.[dataIndex])
            ? Number(daily.temperature_2m_max[dataIndex])
            : null,
          minTempC: isFiniteNumber(daily?.temperature_2m_min?.[dataIndex])
            ? Number(daily.temperature_2m_min[dataIndex])
            : null,
          rainChance: isFiniteNumber(
            daily?.precipitation_probability_max?.[dataIndex],
          )
            ? Math.round(
                Number(daily.precipitation_probability_max[dataIndex]),
              )
            : null,
        };
      })
    : [];

  return {
    available: true,
    location: {
      city,
      latitude: lat,
      longitude: lon,
      timezone: String(weatherData?.timezone || 'UTC'),
    },
    current: {
      tempC: isFiniteNumber(current?.temperature_2m)
        ? Number(current.temperature_2m)
        : null,
      apparentTempC: isFiniteNumber(current?.apparent_temperature)
        ? Number(current.apparent_temperature)
        : null,
      humidity: isFiniteNumber(current?.relative_humidity_2m)
        ? clamp(Number(current.relative_humidity_2m), 0, 100)
        : null,
      windKmh: isFiniteNumber(current?.wind_speed_10m)
        ? Number(current.wind_speed_10m)
        : 0,
      weatherCode: currentCode,
      icon: currentVisual.icon,
      labelKey: currentVisual.labelKey,
      isDay,
      precipitation: isFiniteNumber(current?.precipitation)
        ? Number(current.precipitation)
        : 0,
      rain: isFiniteNumber(current?.rain) ? Number(current.rain) : 0,
      showers: isFiniteNumber(current?.showers)
        ? Number(current.showers)
        : 0,
      snowfall: isFiniteNumber(current?.snowfall)
        ? Number(current.snowfall)
        : 0,
    },
    daily: {
      maxTempC: isFiniteNumber(daily?.temperature_2m_max?.[0])
        ? Number(daily.temperature_2m_max[0])
        : null,
      minTempC: isFiniteNumber(daily?.temperature_2m_min?.[0])
        ? Number(daily.temperature_2m_min[0])
        : null,
      sunrise:
        typeof daily?.sunrise?.[0] === 'string' ? daily.sunrise[0] : '',
      sunset:
        typeof daily?.sunset?.[0] === 'string' ? daily.sunset[0] : '',
      forecastDays,
    },
    intelligenceSignal: buildIntelligenceSignal(weatherData),
    freshness: {
      fetchedAt: nowIso(),
      cacheTtlSec: 60,
      status: 'FRESH',
    },
  };
};

module.exports = {
  getWeatherFeed,
  mapWmoToIcon,
};
