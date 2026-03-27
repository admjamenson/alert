export type PermissionStatus = 'granted' | 'denied' | 'blocked' | 'unavailable';

export type HomeLocationBannerState = 'hidden' | 'needs_permission' | 'blocked';

export const shouldAutoRequestLocationPermission = (
  status: PermissionStatus,
  hasRequestedSession: boolean,
): boolean => status === 'denied' && !hasRequestedSession;

export const getHomeLocationBannerState = (
  status: PermissionStatus,
): HomeLocationBannerState => {
  if (status === 'blocked') return 'blocked';
  if (status === 'denied') return 'needs_permission';
  return 'hidden';
};
