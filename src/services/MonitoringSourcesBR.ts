export type SourceHint = {
  label: string;
  url?: string;
  requiresAccess?: boolean;
};

export const MonitoringSourcesBR: Record<string, SourceHint> = {
  // Infrastructure / official open data (BR)
  energy_outage: {
    label: 'Fonte oficial: ANEEL (Dados Abertos)',
    url: 'https://dadosabertos.aneel.gov.br/',
  },
  water_outage: {
    label: 'Fonte oficial: ANA (HidroWebService)',
    url: 'https://www.ana.gov.br/hidrowebservice/swagger-ui/index.html',
    requiresAccess: true,
  },

  // Hazards (official / institutional sources used by the app today)
  // NOAA (US National Weather Service) - alerts API
  storm: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  flood: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  lightning: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  tornado: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  hurricane: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  landslide: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  hail: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  heatwave: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  fog: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  wildfire: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  tsunami: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  snowstorm: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },
  gale: {
    label: 'Fonte oficial: NOAA / NWS (Weather Alerts)',
    url: 'https://api.weather.gov/',
  },

  // USGS - earthquakes API
  earthquake: {
    label: 'Fonte oficial: USGS (Earthquake Hazards Program)',
    url: 'https://earthquake.usgs.gov/',
  },

  // Pandemic / public health
  pandemic: {
    label: 'Fonte oficial: OMS e autoridades nacionais de saúde',
    url: 'https://data.who.int/dashboards/covid19/data',
  },
  epidemic: {
    label: 'Fonte oficial: secretarias estaduais/municipais de saúde',
  },
};
