import { RouteDestinationService } from '../../services/RouteDestinationService';

export const GetDefaultRouteDestinationQuery = {
  async execute() {
    return RouteDestinationService.getDefaultDestination();
  },
};
