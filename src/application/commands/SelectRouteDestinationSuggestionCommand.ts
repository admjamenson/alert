import OfflineCacheService from '../../services/maps/OfflineCacheService';
import type { PlaceSuggestion } from '../../domain/maps/MapModels';
import type {
  DefaultRouteDestination,
  RouteTransportMode,
} from '../../domain/route/RouteModels';

export const SelectRouteDestinationSuggestionCommand = {
  async execute(params: {
    suggestion: PlaceSuggestion;
    currentLabel?: string;
    transportMode: RouteTransportMode;
  }): Promise<{
    destination: DefaultRouteDestination;
    destinationQuery: string;
    resolvedLabel: string;
  }> {
    await OfflineCacheService.pushRecentPlace(params.suggestion).catch(() => {});

    const resolvedLabel =
      params.currentLabel?.trim() || params.suggestion.name;

    return {
      destination: {
        latitude: params.suggestion.coordinate[1],
        longitude: params.suggestion.coordinate[0],
        label: resolvedLabel,
        transportMode: params.transportMode,
      },
      destinationQuery:
        params.suggestion.address || params.suggestion.name,
      resolvedLabel,
    };
  },
};
