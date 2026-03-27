import { APP_CONFIG } from '../core/config';

export const MAP_MAX_ZOOM = 18;

export const OSM_STYLE_NORMAL = {
  version: 8,
  sources: {
    streets: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      ],
      tileSize: 256,
      attribution: '(c) OpenStreetMap contributors, (c) CARTO',
    },
  },
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: {
        'background-color': '#E7EDF4',
      },
    },
    {
      id: 'streets',
      type: 'raster',
      source: 'streets',
      minzoom: 0,
      maxzoom: MAP_MAX_ZOOM,
      paint: {
        'raster-resampling': 'linear',
      },
    },
  ],
};

export type MapStyleMode = 'default' | 'satellite';
export const MAP_STYLE_MODE_STORAGE_KEY = '@Alert:MapStyleMode';

export const OSM_STYLE_SATELLITE = {
  version: 8,
  sources: {
    satellite: {
      type: 'raster',
      tiles: [
        'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '(c) Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'bg',
      type: 'background',
      paint: {
        'background-color': '#111316',
      },
    },
    {
      id: 'satellite',
      type: 'raster',
      source: 'satellite',
      minzoom: 0,
      maxzoom: MAP_MAX_ZOOM,
      paint: {
        'raster-brightness-min': 0.02,
        'raster-brightness-max': 0.98,
        'raster-resampling': 'linear',
      },
    },
  ],
};

const mapProvider = String(APP_CONFIG.MAP_PROVIDER || 'osm').trim().toLowerCase();
const mapTilerKey = String(APP_CONFIG.MAPTILER_KEY || '').trim();
const mapTilerDefaultUrl = mapTilerKey
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${mapTilerKey}`
  : '';
const mapTilerSatelliteUrl = mapTilerKey
  ? `https://api.maptiler.com/maps/hybrid/style.json?key=${mapTilerKey}`
  : '';

const configuredDefaultStyleUrl = String(APP_CONFIG.MAP_STYLE_DEFAULT_URL || '').trim();
const configuredSatelliteStyleUrl = String(APP_CONFIG.MAP_STYLE_SATELLITE_URL || '').trim();

const defaultStyleUrl =
  configuredDefaultStyleUrl ||
  (mapProvider === 'maptiler' ? mapTilerDefaultUrl : '');

const satelliteStyleUrl =
  configuredSatelliteStyleUrl ||
  (mapProvider === 'maptiler' ? mapTilerSatelliteUrl : '');

export const MAP_STYLE_DEFAULT = defaultStyleUrl || OSM_STYLE_NORMAL;
export const MAP_STYLE_SATELLITE = APP_CONFIG.MAP_SATELLITE_ENABLED
  ? satelliteStyleUrl || OSM_STYLE_SATELLITE
  : MAP_STYLE_DEFAULT;
export const HAS_CONFIGURED_SATELLITE_STYLE = APP_CONFIG.MAP_SATELLITE_ENABLED;
export const MAP_STYLE_SAFE_FALLBACK = OSM_STYLE_NORMAL;

const PANIC_RASTER_PAINT = {
  'raster-saturation': -1,
  'raster-contrast': 0.25,
  'raster-brightness-min': 0.2,
  'raster-brightness-max': 0.85,
};

export const OSM_STYLE_PANIC = {
  ...OSM_STYLE_NORMAL,
  layers: OSM_STYLE_NORMAL.layers.map(layer => {
    if (layer.type !== 'raster') return layer;
    return {
      ...layer,
      paint: {
        ...(layer as any).paint,
        ...PANIC_RASTER_PAINT,
      },
    };
  }),
};

export const OSM_STYLE_SATELLITE_PANIC = {
  ...OSM_STYLE_SATELLITE,
  layers: OSM_STYLE_SATELLITE.layers.map(layer => {
    if (layer.type !== 'raster') return layer;
    return {
      ...layer,
      paint: {
        ...(layer as any).paint,
        ...PANIC_RASTER_PAINT,
      },
    };
  }),
};

export const isRasterStyle = (style: any): boolean =>
  Array.isArray(style?.layers) && style.layers.some((layer: any) => layer?.type === 'raster');
