jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => [{ languageTag: 'ja-JP', countryCode: 'JP' }],
    getTimeZone: () => 'Asia/Tokyo',
  }),
  { virtual: true },
);

import {
  formatDistanceMeters,
  formatTemperatureCelsius,
  resolveRegionalUnits,
} from '../src/utils/measurementUnits';
import {
  formatUpdatedAtDisplay,
  resolveLocale,
  resolveTimeZone,
} from '../src/utils/dateTimeFormat';

describe('global locale, timezone and unit fail-soft behavior', () => {
  it('uses regional units without assuming Brazil or the United States globally', () => {
    expect(resolveRegionalUnits('en-US')).toEqual({
      countryCode: 'US',
      temperature: 'fahrenheit',
      distance: 'mile',
      speed: 'mph',
    });
    expect(resolveRegionalUnits('pt-BR')).toEqual({
      countryCode: 'BR',
      temperature: 'celsius',
      distance: 'kilometer',
      speed: 'kmh',
    });
    expect(formatTemperatureCelsius(20, 'en-US')).toBe('68\u00B0F');
    expect(formatTemperatureCelsius(20, 'fr-FR')).toBe('20\u00B0C');
    expect(formatDistanceMeters(1609.344, 'en-US')).toContain('1');
    expect(formatDistanceMeters(1500, 'pt-BR')).toContain('km');
  });

  it('falls back to device locale and timezone when explicit inputs are invalid', () => {
    expect(resolveLocale()).toBe('ja-JP');
    expect(resolveTimeZone('Invalid/Zone')).toBe('Asia/Tokyo');

    const formatted = formatUpdatedAtDisplay(
      '2026-04-18T12:00:00.000Z',
      'ja-JP',
      'Asia/Tokyo',
    );
    expect(formatted).toBeTruthy();
    expect(formatted).not.toMatch(/invalid|nan|Mon Apr/i);
  });
});
