import { UserIdentityService } from '../../services/UserIdentityService';

export const buildAlertIdentityHeaders = async (): Promise<
  Record<string, string>
> => {
  const [deviceId, userId] = await Promise.all([
    UserIdentityService.getDeviceId(),
    UserIdentityService.getUserPhone(),
  ]);

  return {
    ...(deviceId ? { 'X-Alert-Device-Id': deviceId } : {}),
    ...(userId ? { 'X-Alert-User-Id': userId } : {}),
  };
};
