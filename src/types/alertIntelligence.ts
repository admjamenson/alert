export type AlertSignalSeverity = 'low' | 'medium' | 'high' | 'critical';

export type AlertSignalSource = {
  id?: string;
  name: string;
  url?: string | null;
  officiality?: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' | string;
  sourceClass?: 'OFFICIAL' | 'TRUSTED_SOCIAL' | 'TRUSTED_MEDIA' | 'ESTIMATED' | 'COMMUNITY' | string;
  sourceType?: 'API' | 'RSS' | 'WEB' | string;
  domain?: string;
  trustScore?: number;
  lastCheckedAt?: string | null;
  monitoringDomain?: string;
  [key: string]: any;
};

export type AlertSignal = {
  id?: string;
  category: string;
  severity: AlertSignalSeverity;
  freshness?: AlertSignalFreshness;
  geometry?: {
    type: 'Point' | 'Polygon' | 'LineString' | string;
    coordinates: any;
  };
  timestamp?: string;
  sourceUrl?: string | null;
  officiality?: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' | string;
  summary?: string;
  updatedAt?: string;
  sourceId?: string;
  sourceName?: string;
  confidence?: number;
  trustScore?: number;
  geo?: {
    center?: [number, number];
    radiusKm?: number;
  };
  scope?: string;
  [key: string]: any;
};

export type AlertSignalFreshness = 'FRESH' | 'STALE' | 'UNKNOWN';

export type AlertTrustMeta = {
  status: AlertSignalFreshness;
  updatedAt?: string | null;
  sources: AlertSignalSource[];
  evidencePack: {
    confirmation?:
      | 'COMMUNITY_ONLY'
      | 'MIXED'
      | 'OFFICIAL'
      | 'INITIAL_SIGNAL'
      | 'MULTI_SOURCE_CONFIRMED'
      | 'ESTIMATED_MODEL'
      | string;
    evidenceLinks?: string[];
    evidenceCount?: number;
    sourcesDistinctCount?: number;
    sourceTrustTier?: 'A' | 'B' | 'C' | '' | string;
    verifiedAt?: string | null;
  };
  conflict?: boolean;
};

export type AlertAiSummary = {
  headline?: string;
  summary?: string;
  bullets?: string[];
  action?: string;
  [key: string]: any;
};

export type AlertIntelligenceContext = {
  locale?: string;
  timezone?: string;
  timeZone?: string;
  countryCode?: string;
  admin1Code?: string;
  admin2Code?: string;
  coordinate?: [number, number];
  latitude?: number;
  longitude?: number;
  category?: string;
  scope?: 'CITY' | 'STATE' | 'COUNTRY' | string;
  force?: boolean;
  [key: string]: any;
};
