export type SourceHint = {
  label: string;
  requiresAccess?: boolean;
};

const WEATHER_OFFICIAL_LABEL = 'Fontes oficiais monitoradas pelo Alert';
const SEISMIC_OFFICIAL_LABEL = 'Fontes oficiais de risco geofisico monitoradas pelo Alert';
const HEALTH_OFFICIAL_LABEL = 'Fontes oficiais de saude monitoradas pelo Alert';
const INFRA_OFFICIAL_LABEL = 'Fontes oficiais de infraestrutura monitoradas pelo Alert';

export const MonitoringSourcesBR: Record<string, SourceHint> = {
  energy_outage: {
    label: INFRA_OFFICIAL_LABEL,
  },
  water_outage: {
    label: INFRA_OFFICIAL_LABEL,
    requiresAccess: true,
  },
  storm: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  flood: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  lightning: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  tornado: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  hurricane: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  landslide: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  hail: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  heatwave: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  fog: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  wildfire: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  tsunami: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  snowstorm: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  gale: {
    label: WEATHER_OFFICIAL_LABEL,
  },
  earthquake: {
    label: SEISMIC_OFFICIAL_LABEL,
  },
  pandemic: {
    label: HEALTH_OFFICIAL_LABEL,
  },
  epidemic: {
    label: HEALTH_OFFICIAL_LABEL,
  },
};
