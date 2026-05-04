import { WeatherResult, WeatherService } from '../../services/WeatherService';

export const GetWeatherFeedQuery = {
  async execute(params: {
    latitude: number;
    longitude: number;
    force?: boolean;
  }): Promise<WeatherResult> {
    return WeatherService.getCurrentWeather(params.latitude, params.longitude, {
      force: params.force,
    });
  },

  async getCached(): Promise<WeatherResult | null> {
    return WeatherService.getCachedWeather();
  },
};
