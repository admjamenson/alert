import { RefreshWidgetSnapshotsCommand } from '../../widgets/application/commands/RefreshWidgetSnapshotsCommand';
import type {
  DefaultRouteDestination,
  RouteTransportMode,
} from '../../domain/route/RouteModels';
import {
  RouteDestinationService,
} from '../../services/RouteDestinationService';

export const SaveDefaultRouteDestinationCommand = {
  async execute(params: {
    destination: DefaultRouteDestination;
    label?: string;
    transportMode: RouteTransportMode;
  }): Promise<DefaultRouteDestination> {
    const next: DefaultRouteDestination = {
      latitude: params.destination.latitude,
      longitude: params.destination.longitude,
      label: params.label?.trim() || undefined,
      transportMode: params.transportMode,
    };

    await RouteDestinationService.setDefaultDestination(next);
    await RefreshWidgetSnapshotsCommand.execute({ force: true });
    return next;
  },
};
