import { Platform } from 'react-native';
import { AD_PLACEMENT_IDS, AdPlacementId } from '../../ads/placements';

export type GeoTier = 'tier1' | 'row';
export type AdsPlatform = 'android' | 'ios';

export type FrequencyCapRule = {
  perSession: number;
  perHour: number;
  perDay: number;
  minIntervalSec: number;
};

export type PlacementRule = {
  allowedScreens: string[];
  blockWhen: {
    sosActive: boolean;
    riskHigh: boolean;
    offline: boolean;
  };
  bannerRefreshSec: number;
};

export type AdsConfig = {
  enabled: boolean;
  geoTierRules: {
    tier1Countries: string[];
  };
  adUnitMap: Record<AdsPlatform, Record<GeoTier, Record<AdPlacementId, string>>>;
  frequencyCaps: Record<AdPlacementId, FrequencyCapRule>;
  placementRules: Record<AdPlacementId, PlacementRule>;
};

const ANDROID_TEST_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
  native: 'ca-app-pub-3940256099942544/2247696110',
} as const;

const IOS_TEST_UNITS = {
  banner: 'ca-app-pub-3940256099942544/2934735716',
  interstitial: 'ca-app-pub-3940256099942544/4411468910',
  rewarded: 'ca-app-pub-3940256099942544/1712485313',
  native: 'ca-app-pub-3940256099942544/3986624511',
} as const;

const DEFAULT_TIER_1 = [
  'US',
  'CA',
  'GB',
  'FR',
  'DE',
  'JP',
  'KR',
  'SG',
  'AE',
  'CH',
  'SE',
  'NO',
  'DK',
  'NL',
  'BE',
  'AT',
  'AU',
  'NZ',
  'IE',
  'LU',
  'HK',
];

const buildDefaultFrequencyCaps = (): Record<AdPlacementId, FrequencyCapRule> => ({
  home_footer_banner: {
    perSession: 5,
    perHour: 12,
    perDay: 40,
    minIntervalSec: 90,
  },
  monitoring_feed_inline_banner: {
    perSession: 0,
    perHour: 0,
    perDay: 0,
    minIntervalSec: 3600,
  },
  chat_thread_rewarded: {
    perSession: 3,
    perHour: 4,
    perDay: 10,
    minIntervalSec: 300,
  },
  history_inline_banner: {
    perSession: 4,
    perHour: 8,
    perDay: 30,
    minIntervalSec: 120,
  },
  settings_inline_banner: {
    perSession: 2,
    perHour: 6,
    perDay: 20,
    minIntervalSec: 180,
  },
});

const buildDefaultPlacementRules = (): Record<AdPlacementId, PlacementRule> => ({
  home_footer_banner: {
    allowedScreens: ['Home'],
    blockWhen: { sosActive: true, riskHigh: true, offline: true },
    bannerRefreshSec: 45,
  },
  monitoring_feed_inline_banner: {
    allowedScreens: [],
    blockWhen: { sosActive: true, riskHigh: true, offline: true },
    bannerRefreshSec: 60,
  },
  chat_thread_rewarded: {
    allowedScreens: ['ChatThread'],
    blockWhen: { sosActive: true, riskHigh: true, offline: false },
    bannerRefreshSec: 0,
  },
  history_inline_banner: {
    allowedScreens: ['History'],
    blockWhen: { sosActive: true, riskHigh: true, offline: true },
    bannerRefreshSec: 45,
  },
  settings_inline_banner: {
    allowedScreens: ['Settings'],
    blockWhen: { sosActive: true, riskHigh: true, offline: true },
    bannerRefreshSec: 60,
  },
});

const buildDefaultAdUnitMap = (
  units: typeof ANDROID_TEST_UNITS | typeof IOS_TEST_UNITS,
): Record<GeoTier, Record<AdPlacementId, string>> => ({
  tier1: {
    home_footer_banner: units.banner,
    monitoring_feed_inline_banner: units.banner,
    chat_thread_rewarded: units.rewarded,
    history_inline_banner: units.banner,
    settings_inline_banner: units.banner,
  },
  row: {
    home_footer_banner: units.banner,
    monitoring_feed_inline_banner: units.banner,
    chat_thread_rewarded: units.rewarded,
    history_inline_banner: units.banner,
    settings_inline_banner: units.banner,
  },
});

export const DEFAULT_ADS_CONFIG: AdsConfig = {
  enabled: false,
  geoTierRules: {
    tier1Countries: DEFAULT_TIER_1,
  },
  adUnitMap: {
    android: buildDefaultAdUnitMap(ANDROID_TEST_UNITS),
    ios: buildDefaultAdUnitMap(IOS_TEST_UNITS),
  },
  frequencyCaps: buildDefaultFrequencyCaps(),
  placementRules: buildDefaultPlacementRules(),
};

const ADS_REMOTE_CONFIG_KEY = 'ads_config_v1';

const parseIntSafe = (value: unknown, fallback: number) => {
  const next = Number(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.max(0, Math.floor(next));
};

const normalizeCountryList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return DEFAULT_ADS_CONFIG.geoTierRules.tier1Countries;
  const unique = new Set<string>();
  value.forEach(item => {
    const normalized = String(item || '').trim().toUpperCase();
    if (normalized.length === 2) unique.add(normalized);
  });
  return unique.size > 0 ? Array.from(unique) : DEFAULT_ADS_CONFIG.geoTierRules.tier1Countries;
};

const resolveAdUnitMap = (raw: unknown): AdsConfig['adUnitMap'] => {
  const base = DEFAULT_ADS_CONFIG.adUnitMap;
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as any;
  const out: AdsConfig['adUnitMap'] = {
    android: {
      tier1: { ...base.android.tier1 },
      row: { ...base.android.row },
    },
    ios: {
      tier1: { ...base.ios.tier1 },
      row: { ...base.ios.row },
    },
  };

  (['android', 'ios'] as const).forEach(platformKey => {
    (['tier1', 'row'] as const).forEach(tier => {
      AD_PLACEMENT_IDS.forEach(placementId => {
        const value = src?.[platformKey]?.[tier]?.[placementId];
        if (typeof value === 'string' && value.trim().length > 0) {
          out[platformKey][tier][placementId] = value.trim();
        }
      });
    });
  });

  return out;
};

const resolveFrequencyCaps = (raw: unknown): AdsConfig['frequencyCaps'] => {
  const base = DEFAULT_ADS_CONFIG.frequencyCaps;
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as any;
  const out = { ...base };
  AD_PLACEMENT_IDS.forEach(placementId => {
    out[placementId] = {
      perSession: parseIntSafe(src?.[placementId]?.perSession, base[placementId].perSession),
      perHour: parseIntSafe(src?.[placementId]?.perHour, base[placementId].perHour),
      perDay: parseIntSafe(src?.[placementId]?.perDay, base[placementId].perDay),
      minIntervalSec: parseIntSafe(
        src?.[placementId]?.minIntervalSec,
        base[placementId].minIntervalSec,
      ),
    };
  });
  return out;
};

const resolvePlacementRules = (raw: unknown): AdsConfig['placementRules'] => {
  const base = DEFAULT_ADS_CONFIG.placementRules;
  if (!raw || typeof raw !== 'object') return base;
  const src = raw as any;
  const out = { ...base };
  AD_PLACEMENT_IDS.forEach(placementId => {
    const allowed = src?.[placementId]?.allowedScreens;
    out[placementId] = {
      allowedScreens: Array.isArray(allowed)
        ? allowed
            .map((item: unknown) => String(item || '').trim())
            .filter((item: string) => item.length > 0)
        : base[placementId].allowedScreens,
      blockWhen: {
        sosActive:
          typeof src?.[placementId]?.blockWhen?.sosActive === 'boolean'
            ? src[placementId].blockWhen.sosActive
            : base[placementId].blockWhen.sosActive,
        riskHigh:
          typeof src?.[placementId]?.blockWhen?.riskHigh === 'boolean'
            ? src[placementId].blockWhen.riskHigh
            : base[placementId].blockWhen.riskHigh,
        offline:
          typeof src?.[placementId]?.blockWhen?.offline === 'boolean'
            ? src[placementId].blockWhen.offline
            : base[placementId].blockWhen.offline,
      },
      bannerRefreshSec: parseIntSafe(
        src?.[placementId]?.bannerRefreshSec,
        base[placementId].bannerRefreshSec,
      ),
    };
  });
  return out;
};

export const parseAdsConfig = (raw: unknown): AdsConfig => {
  const fallback = DEFAULT_ADS_CONFIG;
  let src: any = raw;
  if (typeof raw === 'string') {
    try {
      src = JSON.parse(raw);
    } catch {
      src = null;
    }
  }

  if (!src || typeof src !== 'object') return fallback;

  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : fallback.enabled,
    geoTierRules: {
      tier1Countries: normalizeCountryList(src?.geoTierRules?.tier1Countries),
    },
    adUnitMap: resolveAdUnitMap(src?.adUnitMap),
    frequencyCaps: resolveFrequencyCaps(src?.frequencyCaps),
    placementRules: resolvePlacementRules(src?.placementRules),
  };
};

const loadFromGlobalOverride = (): AdsConfig | null => {
  const globalConfig = (globalThis as any)?.__ALERT_ADS_CONFIG__ ?? (globalThis as any)?.ALERT_ADS_CONFIG;
  if (!globalConfig) return null;
  return parseAdsConfig(globalConfig);
};

const loadFromFirebaseRemoteConfig = async (): Promise<AdsConfig | null> => {
  let moduleRef: any = null;
  try {
    moduleRef = require('@react-native-firebase/remote-config');
  } catch {
    return null;
  }

  try {
    const modularRemote = require('@react-native-firebase/remote-config/lib/modular');
    const modularApp = require('@react-native-firebase/app/lib/modular');
    if (
      typeof modularRemote?.getRemoteConfig === 'function' &&
      typeof modularRemote?.fetchAndActivate === 'function' &&
      typeof modularRemote?.getValue === 'function' &&
      typeof modularApp?.getApp === 'function'
    ) {
      const app = modularApp.getApp();
      const rc = modularRemote.getRemoteConfig(app);
      if (typeof modularRemote?.setDefaults === 'function') {
        await modularRemote.setDefaults(rc, {
          [ADS_REMOTE_CONFIG_KEY]: JSON.stringify(DEFAULT_ADS_CONFIG),
        });
      }
      await modularRemote.fetchAndActivate(rc);
      const value = modularRemote.getValue(rc, ADS_REMOTE_CONFIG_KEY)?.asString?.();
      if (typeof value === 'string' && value.trim().length > 0) {
        return parseAdsConfig(value);
      }
    }
  } catch {
    // fall back to namespaced API below
  }

  try {
    if (typeof moduleRef?.default === 'function') {
      const rc = moduleRef.default();
      if (typeof rc?.setDefaults === 'function') {
        await rc.setDefaults({
          [ADS_REMOTE_CONFIG_KEY]: JSON.stringify(DEFAULT_ADS_CONFIG),
        });
      }
      if (typeof rc?.fetchAndActivate === 'function') {
        await rc.fetchAndActivate();
      }
      const value = rc?.getValue?.(ADS_REMOTE_CONFIG_KEY)?.asString?.();
      if (typeof value === 'string' && value.trim().length > 0) {
        return parseAdsConfig(value);
      }
    }
  } catch {
    return null;
  }

  return null;
};

export const loadAdsConfig = async (): Promise<AdsConfig> => {
  const runtime = loadFromGlobalOverride();
  if (runtime) return runtime;

  const remote = await loadFromFirebaseRemoteConfig();
  if (remote) return remote;

  return DEFAULT_ADS_CONFIG;
};

export const getRuntimePlatform = (): AdsPlatform => (Platform.OS === 'ios' ? 'ios' : 'android');

export const getAdsRemoteConfigKey = () => ADS_REMOTE_CONFIG_KEY;
