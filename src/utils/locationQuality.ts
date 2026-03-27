export type LocationPrecision = 'none' | 'imprecise' | 'precise';

export const LOCATION_PRECISION_THRESHOLD_M = 50;

export const isFiniteCoordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const isFiniteCoordinatePair = (
  latitude: unknown,
  longitude: unknown,
): boolean =>
  isFiniteCoordinate(latitude) && isFiniteCoordinate(longitude);

export const isPreciseLocation = (
  accuracyMeters: unknown,
  thresholdMeters = LOCATION_PRECISION_THRESHOLD_M,
): boolean =>
  typeof accuracyMeters === 'number' &&
  Number.isFinite(accuracyMeters) &&
  accuracyMeters >= 0 &&
  accuracyMeters <= thresholdMeters;

export const canUseLocationForRiskMaps = (state: {
  locationPrecision?: LocationPrecision | string | null;
  location?: { latitude?: unknown; longitude?: unknown } | null;
}): boolean =>
  state.locationPrecision === 'precise' &&
  isFiniteCoordinatePair(state.location?.latitude, state.location?.longitude);
