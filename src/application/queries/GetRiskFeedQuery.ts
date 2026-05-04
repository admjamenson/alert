import { AlertNotification } from '../../types/notifications';
import { WeatherService } from '../../services/WeatherService';

export const GetRiskFeedQuery = {
  async execute(params: {
    latitude: number;
    longitude: number;
    riskScore?: number;
    force?: boolean;
  }): Promise<AlertNotification[]> {
    return WeatherService.getAlerts(
      params.latitude,
      params.longitude,
      params.riskScore,
      { force: params.force },
    );
  },
};
