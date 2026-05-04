import { RefreshWidgetSnapshotsCommand } from '../../widgets/application/commands/RefreshWidgetSnapshotsCommand';
import { RouteDestinationService } from '../../services/RouteDestinationService';

export const ClearDefaultRouteDestinationCommand = {
  async execute(): Promise<void> {
    await RouteDestinationService.setDefaultDestination(null);
    await RefreshWidgetSnapshotsCommand.execute({ force: true });
  },
};
