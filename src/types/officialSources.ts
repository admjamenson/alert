export type MonitoringDomain =
  | 'SECURITY'
  | 'SAFETY'
  | 'HEALTH'
  | 'WEATHER'
  | 'DISASTER'
  | 'INFRA'
  | 'TRAFFIC'
  | string;

export type OfficialSource = {
  id: string;
  name: string;
  countryCode: string;
  officiality: 'OFFICIAL' | 'VERIFIED' | 'REFERENCE' | string;
  trustScore: number;
  lastCheckedAt?: string | null;
  monitoringDomain: MonitoringDomain;
  jurisdictionLevel: 'MUNICIPAL' | 'STATE' | 'COUNTRY' | 'ADMIN1' | 'ADMIN2' | string;
  admin1Code?: string | null;
  admin2Code?: string | null;
  admin2Name?: string | null;
  admin3Name?: string | null;
  updateFrequency?: string | null;
  jurisdictionNotes?: string | null;
  notes?: string | null;
  type?: 'API' | 'RSS' | 'WEB' | string;
  url?: string | null;
  [key: string]: any;
};

export type ResolvedSourcesLevel = {
  level: 'MUNICIPAL' | 'STATE' | 'COUNTRY';
  sources: OfficialSource[];
  lastUpdatedAt?: string | null;
  freshestAt?: string | null;
  fallbackApplied?: boolean;
  jurisdictionLabel?: string | null;
  jurisdictionName?: string | null;
  unavailableAtLevel?: boolean;
  [key: string]: any;
};

export type ResolvedSourcesByLevel = {
  levels: ResolvedSourcesLevel[];
  lastUpdatedAt?: string | null;
  registryVersion?: number | null;
  resolvedAt?: string | null;
  [key: string]: any;
};

export type OfficialSourcesRegistry = {
  sources: OfficialSource[];
  lastUpdatedAt?: string | null;
  version?: number;
  generatedAt?: string | null;
  globalFallbacks?: OfficialSource[];
  [key: string]: any;
};

export type UserAdminContext = {
  countryCode?: string | null;
  admin1Code?: string | null;
  admin2Code?: string | null;
  providerUsed?: string;
  admin1NameLocalized?: string | null;
  admin2NameLocalized?: string | null;
  admin3NameLocalized?: string | null;
  countryNameLocalized?: string | null;
  [key: string]: any;
};
