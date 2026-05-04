import type { PlaceSuggestion } from '../../domain/maps/MapModels';
import { GeocodingService } from '../../services/maps';

export const SearchRouteDestinationQuery = {
  async execute(params: {
    query: string;
    locale: string;
    near?: [number, number];
    countryCode?: string;
  }): Promise<PlaceSuggestion[]> {
    return GeocodingService.search({
      query: params.query,
      locale: params.locale,
      near: params.near,
      countryCode: params.countryCode,
    });
  },
};
