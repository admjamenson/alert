import {
  MonitoringDomain,
  OfficialSource,
  OfficialSourcesRegistry,
  ResolvedSourcesByLevel,
  ResolvedSourcesLevel,
  UserAdminContext,
} from '../types/officialSources';

const OFFICIALITY_RANK: Record<OfficialSource['officiality'], number> = {
  OFFICIAL: 0,
  VERIFIED: 1,
  REFERENCE: 2,
};

const normalizeName = (value: string | null | undefined) =>
  String(value || '')
    .trim()
    .toLowerCase();

const parseTimestamp = (value: string | null | undefined) => {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
};

const sortSources = (items: OfficialSource[]) =>
  [...items].sort((a, b) => {
    const officialityDiff = OFFICIALITY_RANK[a.officiality] - OFFICIALITY_RANK[b.officiality];
    if (officialityDiff !== 0) return officialityDiff;
    if (a.trustScore !== b.trustScore) return b.trustScore - a.trustScore;
    return parseTimestamp(b.lastCheckedAt) - parseTimestamp(a.lastCheckedAt);
  });

const dedupeSources = (items: OfficialSource[]) => {
  const unique = new Map<string, OfficialSource>();
  items.forEach(item => {
    if (!unique.has(item.id)) {
      unique.set(item.id, item);
    }
  });
  return Array.from(unique.values());
};

const bestFreshness = (items: OfficialSource[]) => {
  if (!items.length) return null;
  const newest = sortSources(items)[0];
  return newest?.lastCheckedAt || null;
};

const hasDomainsFilter = (domains: MonitoringDomain[]) => domains.length > 0;

const byDomains = (items: OfficialSource[], domains: MonitoringDomain[]) => {
  if (!hasDomainsFilter(domains)) return items;
  const normalizedDomains = new Set(domains);
  if (normalizedDomains.has('SECURITY')) {
    normalizedDomains.add('SAFETY');
  }
  if (normalizedDomains.has('SAFETY')) {
    normalizedDomains.add('SECURITY');
  }
  return items.filter(item => normalizedDomains.has(item.monitoringDomain));
};

const byCountry = (items: OfficialSource[], countryCode?: string | null) => {
  if (!countryCode) return [];
  return items.filter(item => item.countryCode.toUpperCase() === countryCode.toUpperCase());
};

const byAdmin1 = (items: OfficialSource[], admin1Code?: string | null) => {
  if (!admin1Code) return [];
  return items.filter(
    item =>
      item.jurisdictionLevel === 'ADMIN1' &&
      String(item.admin1Code || '').toUpperCase() === admin1Code.toUpperCase(),
  );
};

const byAdmin2 = (
  items: OfficialSource[],
  admin1Code?: string | null,
  admin2Name?: string | null,
  admin3Name?: string | null,
) => {
  const admin2 = normalizeName(admin2Name);
  const admin3 = normalizeName(admin3Name);
  if (!admin2 && !admin3) return [];
  return items.filter(item => {
    if (item.jurisdictionLevel !== 'ADMIN2' && item.jurisdictionLevel !== 'ADMIN3') return false;
    if (admin1Code && item.admin1Code && item.admin1Code.toUpperCase() !== admin1Code.toUpperCase()) {
      return false;
    }
    const itemAdmin2 = normalizeName(item.admin2Name);
    const itemAdmin3 = normalizeName(item.admin3Name);
    return Boolean(
      (admin2 && itemAdmin2 && admin2 === itemAdmin2) ||
        (admin2 && itemAdmin3 && admin2 === itemAdmin3) ||
        (admin3 && itemAdmin3 && admin3 === itemAdmin3) ||
        (admin3 && itemAdmin2 && admin3 === itemAdmin2),
    );
  });
};

const levelTemplate = (
  level: ResolvedSourcesLevel['level'],
  jurisdictionLabel: string,
  jurisdictionName: string,
  sources: OfficialSource[],
  unavailableAtLevel: boolean,
  fallbackApplied: boolean,
): ResolvedSourcesLevel => ({
  level,
  jurisdictionLabel,
  jurisdictionName,
  sources,
  unavailableAtLevel,
  fallbackApplied,
  freshestAt: bestFreshness(sources),
});

export const resolveDomainsFromEventIds = (eventIds: string[]): MonitoringDomain[] => {
  const mapped = new Set<MonitoringDomain>();
  eventIds.forEach(eventId => {
    mapped.add(mapMonitoringEventToDomain(eventId));
  });
  return Array.from(mapped.values());
};

export const mapMonitoringEventToDomain = (eventId: string): MonitoringDomain => {
  const id = String(eventId || '').toLowerCase();
  if (!id) return 'OTHER';
  if (id === 'pandemic' || id === 'epidemic') return 'HEALTH';
  if (id === 'energy_outage' || id === 'water_outage') return 'INFRA';
  if (id.includes('storm') || id.includes('wind') || id.includes('heat') || id.includes('fog')) {
    return 'WEATHER';
  }
  if (
    id.includes('earthquake') ||
    id.includes('flood') ||
    id.includes('landslide') ||
    id.includes('hurricane') ||
    id.includes('tornado') ||
    id.includes('tsunami') ||
    id.includes('wildfire') ||
    id.includes('avalanche') ||
    id.includes('cyclone') ||
    id.includes('volcano') ||
    id.includes('drought')
  ) {
    return 'DISASTER';
  }
  if (
    id.includes('safety') ||
    id.includes('crime') ||
    id.includes('violence') ||
    id.includes('sos') ||
    id.includes('guardian')
  ) {
    return 'SECURITY';
  }
  return 'OTHER';
};

export const resolveOfficialSourcesWithRegistry = (
  context: UserAdminContext,
  registry: OfficialSourcesRegistry,
  monitoringDomainsNeeded: MonitoringDomain[],
): ResolvedSourcesByLevel => {
  const registrySources = Array.isArray(registry.sources) ? registry.sources : [];
  const registryFallbacks = Array.isArray(registry.globalFallbacks)
    ? registry.globalFallbacks
    : [];
  const countryItems = byCountry(registrySources, context.countryCode);
  const filteredCountryItems = byDomains(countryItems, monitoringDomainsNeeded);
  const globalFallbacks = sortSources(byDomains(registryFallbacks, monitoringDomainsNeeded));

  const municipalPrimary = sortSources(
    byAdmin2(
      filteredCountryItems,
      context.admin1Code,
      context.admin2NameLocalized,
      context.admin3NameLocalized,
    ),
  );
  const statePrimary = sortSources(byAdmin1(filteredCountryItems, context.admin1Code));
  const countryPrimary = sortSources(
    filteredCountryItems.filter(item => item.jurisdictionLevel === 'ADMIN0'),
  );

  const municipalFallback = dedupeSources([
    ...statePrimary.slice(0, 3),
    ...countryPrimary.slice(0, 3),
    ...globalFallbacks.slice(0, 3),
  ]);
  const stateFallback = dedupeSources([
    ...countryPrimary.slice(0, 3),
    ...globalFallbacks.slice(0, 3),
  ]);
  const countryFallback = dedupeSources(globalFallbacks.slice(0, 4));

  const municipalSources = municipalPrimary.length > 0 ? municipalPrimary : municipalFallback;
  const stateSources = statePrimary.length > 0 ? statePrimary : stateFallback;
  const countrySources = countryPrimary.length > 0 ? countryPrimary : countryFallback;

  const municipalName =
    context.admin2NameLocalized || context.admin3NameLocalized || 'Unavailable';
  const stateName = context.admin1NameLocalized || context.admin1Code || 'Unavailable';
  const countryName = context.countryNameLocalized || context.countryCode || 'Unavailable';

  return {
    resolvedAt: new Date().toISOString(),
    context,
    registryVersion: registry.version,
    levels: [
      levelTemplate(
        'MUNICIPAL',
        'Municipality / District',
        municipalName,
        municipalSources,
        municipalPrimary.length === 0,
        municipalPrimary.length === 0,
      ),
      levelTemplate(
        'STATE',
        'State / Region',
        stateName,
        stateSources,
        statePrimary.length === 0,
        statePrimary.length === 0,
      ),
      levelTemplate(
        'COUNTRY',
        'Country',
        countryName,
        countrySources,
        countryPrimary.length === 0,
        countryPrimary.length === 0,
      ),
    ],
  };
};

export const OfficialSourcesResolver = {
  async resolveOfficialSources(
    context: UserAdminContext,
    monitoringDomainsNeeded: MonitoringDomain[],
  ): Promise<ResolvedSourcesByLevel> {
    const { OfficialSourcesRegistryService } = await import('./OfficialSourcesRegistryService');
    const registry = await OfficialSourcesRegistryService.getRegistry();
    return resolveOfficialSourcesWithRegistry(context, registry, monitoringDomainsNeeded);
  },
};

export default OfficialSourcesResolver;
