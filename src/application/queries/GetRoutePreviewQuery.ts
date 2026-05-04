import type {
  RouteDetails,
  RoutePoint,
  RouteTransportMode,
} from '../../domain/route/RouteModels';
import { RouteService } from '../../services/RouteService';

export const GetRoutePreviewQuery = {
  async execute(params: {
    from: RoutePoint;
    to: RoutePoint;
    transportMode: RouteTransportMode;
  }): Promise<RouteDetails | null> {
    return RouteService.getRouteDetails(
      params.from,
      params.to,
      params.transportMode,
    );
  },
};
