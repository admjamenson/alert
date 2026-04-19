const { reverseGeocode } = require('../eventHub/adapters/geocodingAdapter');

const resolveLocationByCoordinates = async (
  { latitude, longitude, locale },
  { config } = {},
) => {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  const payload = await reverseGeocode(
    {
      latitude: lat,
      longitude: lon,
      locale,
    },
    {
      userAgent: config?.weather?.userAgent,
    },
  );
  const row = payload?.adminContext;
  if (!row) return null;

  return {
    country: String(row.countryCode || '').toUpperCase(),
    admin1: String(row.stateName || '').trim(),
    city: String(row.cityName || row.countyName || '').trim(),
  };
};

module.exports = {
  resolveLocationByCoordinates,
};
