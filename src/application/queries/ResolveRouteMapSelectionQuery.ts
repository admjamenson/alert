import OfflineCacheService from '../../services/maps/OfflineCacheService';
import type { PlaceSuggestion } from '../../domain/maps/MapModels';
import { GeocodingService } from '../../services/maps';
import type {
  DefaultRouteDestination,
  RouteTransportMode,
} from '../../domain/route/RouteModels';

export const ResolveRouteMapSelectionQuery = {
  async execute(params: {
    latitude: number;
    longitude: number;
    locale: string;
    currentLabel?: string;
    transportMode: RouteTransportMode;
  }): Promise<{
    destination: DefaultRouteDestination;
    destinationQuery: string;
    resolvedLabel: string;
    place: PlaceSuggestion | null;
  }> {
    const destination: DefaultRouteDestination = {
      latitude: params.latitude,
      longitude: params.longitude,
      label: params.currentLabel?.trim() || undefined,
      transportMode: params.transportMode,
    };

    try {
      const place = await GeocodingService.reverse({
        coordinate: [params.longitude, params.latitude],
        locale: params.locale,
      });
      if (place) {
        await OfflineCacheService.pushRecentPlace(place).catch(() => {});
      }
      return {
        destination: {
          ...destination,
          label: params.currentLabel?.trim() || place?.name || destination.label,
        },
        destinationQuery: place?.address || place?.name || '',
        resolvedLabel: params.currentLabel?.trim() || place?.name || '',
        place: place || null,
      };
    } catch {
      return {
        destination,
        destinationQuery: '',
        resolvedLabel: params.currentLabel?.trim() || '',
        place: null,
      };
    }
  },
};
