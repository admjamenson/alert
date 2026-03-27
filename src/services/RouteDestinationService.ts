import AsyncStorage from '@react-native-async-storage/async-storage';

const DESTINATION_KEY = '@Alert:DefaultRouteDestination';

export type RouteTransportMode = 'car' | 'bus' | 'motorcycle' | 'bike' | 'walk';

export type DefaultRouteDestination = {
  latitude: number;
  longitude: number;
  label?: string;
  transportMode?: RouteTransportMode;
};

const parseJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const normalizeTransportMode = (value: unknown): RouteTransportMode => {
  if (
    value === 'car' ||
    value === 'bus' ||
    value === 'motorcycle' ||
    value === 'bike' ||
    value === 'walk'
  ) {
    return value;
  }
  return 'car';
};

export const RouteDestinationService = {
  async getDefaultDestination(): Promise<DefaultRouteDestination | null> {
    const raw = await AsyncStorage.getItem(DESTINATION_KEY);
    const parsed = parseJson<DefaultRouteDestination>(raw);
    const lat = Number(parsed?.latitude);
    const lon = Number(parsed?.longitude);
    if (!isFiniteCoord(lat) || !isFiniteCoord(lon)) return null;
    return {
      latitude: lat,
      longitude: lon,
      label: parsed?.label,
      transportMode: normalizeTransportMode(parsed?.transportMode),
    };
  },

  async setDefaultDestination(dest: DefaultRouteDestination | null): Promise<void> {
    if (!dest) {
      await AsyncStorage.removeItem(DESTINATION_KEY);
      return;
    }
    await AsyncStorage.setItem(DESTINATION_KEY, JSON.stringify(dest));
  },
};
