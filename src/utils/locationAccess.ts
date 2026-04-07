export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

export type HomeLocationBannerState = 'hidden' | 'needs_permission' | 'blocked';

export const shouldAutoRequestLocationPermission = (
  status: PermissionStatus,
  hasRequestedSession: boolean,
): boolean => status === 'denied' && !hasRequestedSession;

export const getHomeLocationBannerState = (
  status: PermissionStatus,
): HomeLocationBannerState => {
  // Treat both "blocked" (never ask again) and "unavailable" (system GPS off)
  // as actionable states so the user sees the CTA to enable location.
  if (status === 'blocked') return 'blocked';
  if (status === 'denied' || status === 'unavailable')
    return 'needs_permission';
  return 'hidden';
};
