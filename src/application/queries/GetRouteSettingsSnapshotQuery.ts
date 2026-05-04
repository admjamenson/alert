import { GetDefaultRouteDestinationQuery } from './GetDefaultRouteDestinationQuery';
import { ProfileService } from '../../services/ProfileService';
import type {
  DefaultRouteDestination,
  RouteTransportMode,
} from '../../domain/route/RouteModels';

export const GetRouteSettingsSnapshotQuery = {
  async execute(): Promise<{
    avatarUri: string | null;
    destination: DefaultRouteDestination | null;
    label: string;
    destinationQuery: string;
    transportMode: RouteTransportMode;
  }> {
    const [profile, destination] = await Promise.all([
      ProfileService.getProfile().catch(() => ({ name: '', avatarUri: undefined })),
      GetDefaultRouteDestinationQuery.execute().catch(() => null),
    ]);

    const avatarUri =
      typeof profile?.avatarUri === 'string' && profile.avatarUri.trim().length > 0
        ? profile.avatarUri.trim()
        : null;
    const label = String(destination?.label || '').trim();

    return {
      avatarUri,
      destination,
      label,
      destinationQuery: label,
      transportMode: destination?.transportMode || 'car',
    };
  },
};
