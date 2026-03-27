export type MonitoringEvent = {
  id: string;
  icon: string;
};

export const FEATURED_EVENTS_KEY = '@Alert:MonitoringFeatured';

export const MONITORING_EVENTS: MonitoringEvent[] = [
  { id: 'energy_outage', icon: 'power-plug-off' },
  { id: 'water_outage', icon: 'water-off' },
  { id: 'earthquake', icon: 'earth' },
  { id: 'flood', icon: 'waves' },
  { id: 'heat', icon: 'thermometer-high' },
  { id: 'wind', icon: 'weather-windy' },
  { id: 'storm', icon: 'weather-lightning-rainy' },
  { id: 'lightning', icon: 'weather-lightning' },
  { id: 'cyclone', icon: 'weather-hurricane' },
  { id: 'tornado', icon: 'weather-tornado' },
  { id: 'hurricane', icon: 'weather-hurricane' },
  { id: 'landslide', icon: 'terrain' },
  { id: 'pandemic', icon: 'biohazard' },
  { id: 'epidemic', icon: 'virus' },
  { id: 'snowstorm', icon: 'snowflake' },
  { id: 'avalanche', icon: 'snowflake' },
  { id: 'wildfire', icon: 'fire' },
  { id: 'hail', icon: 'weather-hail' },
  { id: 'heatwave', icon: 'thermometer-high' },
  { id: 'tsunami', icon: 'waves' },
  { id: 'meteor', icon: 'meteor' },
  { id: 'fog', icon: 'weather-fog' },
  { id: 'drought', icon: 'water-alert' },
  { id: 'gale', icon: 'weather-windy-variant' },
  { id: 'volcano', icon: 'volcano' },
  { id: 'high_tide', icon: 'waves' },
  { id: 'sandstorm', icon: 'weather-windy' },
  { id: 'downdraft', icon: 'weather-windy' },
  { id: 'volcanic_cloud', icon: 'cloud-alert' },
  { id: 'rogue_waves', icon: 'waves' },
  { id: 'wind_gust_50', icon: 'weather-windy' },
  { id: 'wind_gust_10', icon: 'weather-windy' },
  { id: 'dust_devils', icon: 'weather-dust' },
];

export const DEFAULT_FEATURED_EVENT_IDS = [
  'energy_outage',
  'water_outage',
  'earthquake',
  'flood',
  'storm',
  'wildfire',
  'pandemic',
];

export const MANUAL_ONLY_EVENT_IDS = new Set<string>([
  'energy_outage',
  'water_outage',
  'pandemic',
  'epidemic',
  'meteor',
  'volcanic_cloud',
  'rogue_waves',
  'dust_devils',
]);
