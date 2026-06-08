import {selectWeatherVisual} from '../src/domain/weather/WeatherVisualSelector';
import {
  WEATHER_DAY_PHASE_GRADIENTS,
  resolveWeatherDayPhase,
  resolveWeatherVisualTheme,
} from '../src/domain/weather/WeatherVisualTheme';

const hexLuminance = (color: string) => {
  const hex = color.replace('#', '');
  const channels = [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value =>
    value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const expectDarkReadableTheme = (theme: ReturnType<typeof resolveWeatherVisualTheme>) => {
  expect(hexLuminance(theme.cardBackground)).toBeLessThan(0.12);
  expect(theme.textPrimaryColor).toBe('#FFFFFF');
  expect(theme.textSecondaryColor).toContain('0.88');
  expect(theme.chipBackgroundColor).toBe('rgba(0,0,0,0.38)');
  expect(theme.chipBorderColor).toBe('rgba(255,255,255,0.14)');
  expect(theme.riskStatus).toBeTruthy();
  expect(theme.riskLabel).toBe(theme.riskStatus.labelEn);
  expect(theme.riskAccentColor).toBe(theme.riskStatus.accentColor);
};

describe('WeatherVisualSelector - deterministic moon and fallback', () => {
  it('returns the same moon asset for the same date (deterministic color)', () => {
    const context = {
      weatherCondition: null,
      isDay: false,
      localTime: new Date('2026-05-26T03:00:00Z'),
      sunriseTime: null,
      sunsetTime: null,
      precipitationType: 'none',
      thunderstormRisk: false,
      hailRisk: false,
      snowRisk: false,
      freshness: 'fresh',
      sourceConfidence: 0.8,
    } as any;

    const first = selectWeatherVisual(context);
    const second = selectWeatherVisual(context);
    expect(first.assetId).toBe(second.assetId);
  });

  it('falls back safely when condition is missing', () => {
    const context = {
      weatherCondition: undefined,
      isDay: true,
      localTime: Date.now(),
      sunriseTime: null,
      sunsetTime: null,
      precipitationType: 'none',
      thunderstormRisk: false,
      hailRisk: false,
      snowRisk: false,
      freshness: 'fresh',
      sourceConfidence: 0.2,
    } as any;

    const decision = selectWeatherVisual(context);
    expect(decision).toBeDefined();
    expect(decision.assetId).toBeTruthy();
  });
});

describe('resolveWeatherVisualTheme - dark readable weather identity', () => {
  it.each([
    ['morning', 6, ['#5B86E5', '#3B5F9C', '#18243D']],
    ['noon', 12, ['#4DA8FF', '#2E5EAA', '#12233F']],
    ['afternoon', 15, ['#4F6D8C', '#344B63', '#161F2B']],
    ['sunset', 18, ['#A35D3B', '#6A3B2A', '#241611']],
    ['night', 20, ['#233A66', '#101C33', '#060B14']],
    ['midnight', 0, ['#111827', '#090E18', '#03060B']],
    ['predawn', 4, ['#2C3E57', '#182434', '#070B12']],
  ] as const)(
    'uses the %s premium day-phase gradient',
    (_phase, localHour, gradient) => {
      const theme = resolveWeatherVisualTheme({
        condition: 'clear_day',
        localHour,
        systemColorScheme: 'light',
      });

      expect(theme.backgroundGradient).toEqual(gradient);
      expect(theme.textPrimaryColor).toBe('#FFFFFF');
      expect(theme.textSecondaryColor).toBe('rgba(255,255,255,0.88)');
      expect(theme.chipBackgroundColor).toBe('rgba(0,0,0,0.38)');
      expect(theme.chipBorderColor).toBe('rgba(255,255,255,0.14)');
      expectDarkReadableTheme(theme);
    },
  );

  it('exports the final day-phase palette centrally', () => {
    expect(WEATHER_DAY_PHASE_GRADIENTS).toEqual({
      morning: ['#5B86E5', '#3B5F9C', '#18243D'],
      noon: ['#4DA8FF', '#2E5EAA', '#12233F'],
      afternoon: ['#4F6D8C', '#344B63', '#161F2B'],
      sunset: ['#A35D3B', '#6A3B2A', '#241611'],
      night: ['#233A66', '#101C33', '#060B14'],
      midnight: ['#111827', '#090E18', '#03060B'],
      predawn: ['#2C3E57', '#182434', '#070B12'],
    });
  });

  it('uses real sunset timing for the copper sunset phase', () => {
    expect(
      resolveWeatherDayPhase({
        date: '2026-06-08T20:45:00.000Z',
        sunrise: '2026-06-08T08:30:00.000Z',
        sunset: '2026-06-08T21:00:00.000Z',
        timezone: 'America/Fortaleza',
      }),
    ).toBe('sunset');
  });

  it('falls back to local hour when sunrise and sunset are unavailable', () => {
    expect(resolveWeatherDayPhase({localHour: 4})).toBe('predawn');
    expect(resolveWeatherDayPhase({localHour: 12})).toBe('noon');
    expect(resolveWeatherDayPhase({localHour: 23})).toBe('midnight');
  });

  it('keeps sunny weather navy with golden and blue identity in dark mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'clear_day',
      isDay: true,
      timeOfDay: 'midday',
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expect(theme.accentColor).toBe('#FFD166');
    expect(theme.riskStatus.level).toBe('safe');
    expectDarkReadableTheme(theme);
  });

  it('keeps sunny weather dark and readable in light mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'clear_day',
      isDay: true,
      timeOfDay: 'midday',
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expect(theme.riskStatus.level).toBe('safe');
    expectDarkReadableTheme(theme);
  });

  it('uses a dark amber gradient for sunny sunset', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'clear_day',
      isDay: true,
      timeOfDay: 'sunset',
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#A35D3B', '#6A3B2A', '#241611']),
    );
    expect(theme.cardBackground).toBe('#241611');
    expect(theme.backgroundGradient).not.toContain('#FFD166');
    expectDarkReadableTheme(theme);
  });

  it('keeps storm weather purple and electric in dark mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'thunderstorm',
      isDay: true,
      thunderstorm: true,
      timeOfDay: 'midday',
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expect(theme.iconPrimaryColor).toBe('#FFFFFF');
    expect(theme.accentColor).toBe('#B46BFF');
    expect(theme.riskStatus.level).toBe('danger');
    expect(theme.riskStatus.source).toBe('internal_condition');
    expectDarkReadableTheme(theme);
  });

  it('keeps storm weather purple and electric in light mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'thunderstorm',
      isDay: true,
      thunderstorm: true,
      timeOfDay: 'midday',
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4DA8FF', '#2E5EAA', '#12233F']),
    );
    expectDarkReadableTheme(theme);
  });

  it('uses official-alert source only when a real risk level is provided', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'rain',
      isDay: true,
      riskLevel: 'high',
      systemColorScheme: 'light',
    });

    expect(theme.riskStatus.level).toBe('danger');
    expect(theme.riskStatus.source).toBe('official_alert');
    expect(theme.riskAccentColor).toBe('#F97316');
  });

  it('keeps rain blue and cyan on a deep base in dark mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'rain',
      isDay: true,
      precipitation: 80,
      timeOfDay: 'night',
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#233A66', '#101C33', '#060B14']),
    );
    expect(theme.accentColor).toBe('#37D5FF');
    expect(theme.riskStatus.level).toBe('watch');
    expect(theme.riskStatus.source).toBe('internal_condition');
    expectDarkReadableTheme(theme);
  });

  it('keeps cloudy weather silver blue on a dark graphite base in light mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'cloudy_day',
      isDay: true,
      timeOfDay: 'afternoon',
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#4F6D8C', '#344B63', '#161F2B']),
    );
    expect(theme.accentColor).toBe('#B8C9DA');
    expect(theme.riskStatus.level).toBe('low');
    expectDarkReadableTheme(theme);
  });

  it('uses a warm graphite gradient for cloudy sunset', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'cloudy_day',
      isDay: true,
      timeOfDay: 'sunset',
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#A35D3B', '#6A3B2A', '#241611']),
    );
    expect(theme.cardBackground).toBe('#241611');
    expectDarkReadableTheme(theme);
  });

  it('keeps clear night navy and lunar in light and dark mode', () => {
    const light = resolveWeatherVisualTheme({
      condition: 'clear_night',
      isDay: false,
      timeOfDay: 'night',
      systemColorScheme: 'light',
    });
    const dark = resolveWeatherVisualTheme({
      condition: 'clear_night',
      isDay: false,
      timeOfDay: 'night',
      systemColorScheme: 'dark',
    });

    expect(light.backgroundGradient).toEqual(dark.backgroundGradient);
    expect(light.backgroundGradient).toEqual(
      expect.arrayContaining(['#233A66', '#101C33', '#060B14']),
    );
    expectDarkReadableTheme(light);
    expectDarkReadableTheme(dark);
  });

  it('keeps phase gradient while cloudy, rain, and storm alter accents', () => {
    const cloudy = resolveWeatherVisualTheme({
      condition: 'cloudy_day',
      timeOfDay: 'morning',
      systemColorScheme: 'light',
    });
    const rain = resolveWeatherVisualTheme({
      condition: 'rain',
      timeOfDay: 'morning',
      systemColorScheme: 'light',
    });
    const storm = resolveWeatherVisualTheme({
      condition: 'thunderstorm',
      timeOfDay: 'morning',
      thunderstorm: true,
      systemColorScheme: 'light',
    });

    expect(cloudy.backgroundGradient).toEqual(
      WEATHER_DAY_PHASE_GRADIENTS.morning,
    );
    expect(rain.backgroundGradient).toEqual(
      WEATHER_DAY_PHASE_GRADIENTS.morning,
    );
    expect(storm.backgroundGradient).toEqual(
      WEATHER_DAY_PHASE_GRADIENTS.morning,
    );
    expect(cloudy.accentColor).toBe('#B8C9DA');
    expect(rain.accentColor).toBe('#4DE3FF');
    expect(storm.accentColor).toBe('#B46BFF');
  });
});
