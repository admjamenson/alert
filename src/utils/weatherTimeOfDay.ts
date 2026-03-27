export type TimeOfDayPhase = 'day' | 'dawn' | 'dusk' | 'night';

type TimeOfDayArgs = {
  now?: Date | string | number;
  timezone?: string | null;
  isDay?: boolean | null;
  sunrise?: string | null;
  sunset?: string | null;
};

const MINUTES_IN_DAY = 24 * 60;
const DAWN_WINDOW_MINUTES = 75;
const DUSK_WINDOW_MINUTES = 75;

const normalizeMinutes = (value: number) => {
  const next = value % MINUTES_IN_DAY;
  return next < 0 ? next + MINUTES_IN_DAY : next;
};

const isInCircularRange = (value: number, start: number, end: number) => {
  const v = normalizeMinutes(value);
  const s = normalizeMinutes(start);
  const e = normalizeMinutes(end);
  if (s <= e) return v >= s && v <= e;
  return v >= s || v <= e;
};

const parseClockMinutes = (value?: string | null): number | null => {
  if (!value || typeof value !== 'string') return null;
  const match = value.match(/T(\d{2}):(\d{2})|(?:^|\s)(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[1] ?? match[3]);
  const minute = Number(match[2] ?? match[4]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return normalizeMinutes(hour * 60 + minute);
};

const getClockMinutesInTimeZone = (date: Date, timeZone?: string | null): number => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || undefined,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = formatter.formatToParts(date);
    const hour = Number(parts.find(p => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find(p => p.type === 'minute')?.value ?? '0');
    if (Number.isFinite(hour) && Number.isFinite(minute)) {
      return normalizeMinutes(hour * 60 + minute);
    }
  } catch {
    // ignore and fallback below
  }

  return normalizeMinutes(date.getHours() * 60 + date.getMinutes());
};

export const getTimeOfDayPhase = ({
  now = new Date(),
  timezone,
  isDay,
  sunrise,
  sunset,
}: TimeOfDayArgs): TimeOfDayPhase => {
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) {
    return isDay ? 'day' : 'night';
  }

  const currentMinutes = getClockMinutesInTimeZone(date, timezone);
  const sunriseMinutes = parseClockMinutes(sunrise);
  const sunsetMinutes = parseClockMinutes(sunset);

  if (sunriseMinutes !== null && sunsetMinutes !== null) {
    const dawnStart = sunriseMinutes - 30;
    const dawnEnd = sunriseMinutes + DAWN_WINDOW_MINUTES;
    const duskStart = sunsetMinutes - DUSK_WINDOW_MINUTES;
    const duskEnd = sunsetMinutes + 45;

    if (isInCircularRange(currentMinutes, dawnStart, dawnEnd)) return 'dawn';
    if (isInCircularRange(currentMinutes, duskStart, duskEnd)) return 'dusk';
    if (isInCircularRange(currentMinutes, dawnEnd + 1, duskStart - 1)) return 'day';
    return 'night';
  }

  if (typeof isDay === 'boolean') {
    return isDay ? 'day' : 'night';
  }

  return currentMinutes >= 6 * 60 && currentMinutes < 18 * 60 ? 'day' : 'night';
};

