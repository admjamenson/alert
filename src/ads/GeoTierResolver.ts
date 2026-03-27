import * as RNLocalize from 'react-native-localize';
import { AdsConfig, GeoTier } from '../config/remoteConfig/adsConfig';

export type GeoTierResolution = {
  geoTier: GeoTier;
  countryCode: string;
};

const FALLBACK_COUNTRY = 'ZZ';

const resolveCountryCode = (): string => {
  const direct = String((RNLocalize as any)?.getCountry?.() || '')
    .trim()
    .toUpperCase();
  if (direct.length === 2) return direct;

  const locales = RNLocalize.getLocales();
  if (Array.isArray(locales) && locales.length > 0) {
    const country = String(locales[0]?.countryCode || '')
      .trim()
      .toUpperCase();
    if (country.length === 2) return country;
  }

  return FALLBACK_COUNTRY;
};

export const resolveGeoTier = (config: AdsConfig): GeoTierResolution => {
  const countryCode = resolveCountryCode();
  const tier1 = new Set(
    (config.geoTierRules?.tier1Countries || []).map(item => String(item).toUpperCase()),
  );
  const geoTier: GeoTier = tier1.has(countryCode) ? 'tier1' : 'row';
  return { geoTier, countryCode };
};
