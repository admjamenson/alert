import {resolveWeatherDayPhase} from '../domain/weather/WeatherVisualTheme';
import type {WeatherDayPhase} from '../domain/weather/WeatherVisualModels';

export type TimeOfDayPhase = WeatherDayPhase;

type TimeOfDayArgs = {
  now?: Date | string | number;
  timezone?: string | null;
  isDay?: boolean | null;
  sunrise?: string | null;
  sunset?: string | null;
};

export const getTimeOfDayPhase = ({
  now = new Date(),
  timezone,
  isDay,
  sunrise,
  sunset,
}: TimeOfDayArgs): TimeOfDayPhase => {
  const phase = resolveWeatherDayPhase({
    date: now,
    sunrise,
    sunset,
    timezone,
  });

  if (typeof isDay === 'boolean' && !isDay && phase === 'noon') {
    return 'night';
  }

  return phase;
};
