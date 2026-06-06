import {selectWeatherVisual} from '../src/domain/weather/WeatherVisualSelector';
import {resolveWeatherVisualTheme} from '../src/domain/weather/WeatherVisualTheme';

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
  expect(theme.chipBackgroundColor).toBe('rgba(0,0,0,0.46)');
  expect(theme.chipBorderColor).toBe('rgba(255,255,255,0.16)');
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
  it('keeps sunny weather navy with golden and blue identity in dark mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'clear_day',
      isDay: true,
      timeOfDay: 'midday',
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#26365A', '#101B34', '#060812']),
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
      expect.arrayContaining(['#26365A', '#101B34', '#060812']),
    );
    expect(theme.riskStatus.level).toBe('safe');
    expectDarkReadableTheme(theme);
  });

  it('keeps storm weather purple and electric in dark mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'thunderstorm',
      isDay: true,
      thunderstorm: true,
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#281B4D', '#101527', '#05070F']),
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
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#281B4D', '#101527', '#05070F']),
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
      systemColorScheme: 'dark',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#12324A', '#081B2A', '#04070C']),
    );
    expect(theme.accentColor).toBe('#4DE3FF');
    expect(theme.riskStatus.level).toBe('watch');
    expect(theme.riskStatus.source).toBe('internal_condition');
    expectDarkReadableTheme(theme);
  });

  it('keeps cloudy weather silver blue on a dark graphite base in light mode', () => {
    const theme = resolveWeatherVisualTheme({
      condition: 'cloudy_day',
      isDay: true,
      systemColorScheme: 'light',
    });

    expect(theme.backgroundGradient).toEqual(
      expect.arrayContaining(['#263746', '#101820', '#060A0F']),
    );
    expect(theme.accentColor).toBe('#B8C9DA');
    expect(theme.riskStatus.level).toBe('low');
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
      expect.arrayContaining(['#1B2A55', '#0B1020', '#04060C']),
    );
    expectDarkReadableTheme(light);
    expectDarkReadableTheme(dark);
  });
});
