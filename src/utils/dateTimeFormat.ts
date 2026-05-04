import { getLocales, getTimeZone as getLocalizeTimeZone } from 'react-native-localize';
import { resolveSupportedLocale } from '../constants/locales';

export type DateLike = string | number | Date;
type ExtendedDateTimeFormatOptions = Intl.DateTimeFormatOptions & {
  fractionalSecondDigits?: number;
};

const DEFAULT_LOCALE = 'en-US';
const NATIVE_DATE_STRING_PATTERN =
  /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}\s(?:\d{4}\s)?\d{2}:\d{2}:\d{2}(?:\s\d{4})?/i;
const NATIVE_DATE_STRING_HINT =
  /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b[\s,]+\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i;
const DATE_TIME_OPTION_KEYS = [
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
  'hourCycle',
  'hour12',
] as const satisfies readonly string[];
const UPDATED_AT_BASE_OPTIONS: ExtendedDateTimeFormatOptions = {
  year: '2-digit',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
};
type DateOrder = 'DMY' | 'MDY' | 'YMD';
type NumericDateTimeParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
};
const pad2 = (value: number) => String(Math.max(0, value)).padStart(2, '0');
const normalizeYear2Digit = (value: string) => String(value || '').slice(-2).padStart(2, '0');

export const isNativeDateStringLike = (text: unknown): boolean => {
  if (typeof text !== 'string') return false;
  const normalized = text.trim();
  return NATIVE_DATE_STRING_PATTERN.test(normalized) || NATIVE_DATE_STRING_HINT.test(normalized);
};

export const isInvalidFormattedDateLike = (text: unknown): boolean => {
  if (typeof text !== 'string') return true;
  const normalized = text.trim();
  if (!normalized) return true;
  if (/invalid\s*date/i.test(normalized)) return true;
  if (/\bnan\b/i.test(normalized)) return true;
  return false;
};

export const sanitizeFormattedDateOutput = (text: unknown): string => {
  const normalized = String(text || '').trim();
  if (!normalized) return '';
  if (isNativeDateStringLike(normalized)) return '';
  if (isInvalidFormattedDateLike(normalized)) return '';
  return normalized;
};

const isValidTimeZone = (timeZone?: string | null): boolean => {
  const safeTimeZone = String(timeZone || '').trim();
  if (!safeTimeZone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
};

export const normalizeDateTimeInput = (value: unknown): Date | null => {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value as any);
  return Number.isFinite(date.getTime()) ? date : null;
};

export const normalizeToIsoDateTime = (value: unknown): string | '' => {
  const date = normalizeDateTimeInput(value);
  if (!date) return '';
  return date.toISOString();
};

export const resolveLocale = (preferredLocale?: string | null): string => {
  const safePreferred = String(preferredLocale || '')
    .trim()
    .replace(/_/g, '-');
  if (safePreferred) {
    if (safePreferred.includes('-')) return safePreferred;
    return resolveSupportedLocale(safePreferred);
  }

  const deviceLocale = String(getLocales()?.[0]?.languageTag || '')
    .trim()
    .replace(/_/g, '-');
  if (deviceLocale) {
    if (deviceLocale.includes('-')) return deviceLocale;
    return resolveSupportedLocale(deviceLocale);
  }
  return DEFAULT_LOCALE;
};

export const resolveTimeZone = (preferredTimeZone?: string | null): string | undefined => {
  const safePreferred = String(preferredTimeZone || '').trim();
  if (safePreferred && isValidTimeZone(safePreferred)) return safePreferred;

  try {
    const localizeTz = typeof getLocalizeTimeZone === 'function' ? getLocalizeTimeZone() : '';
    if (localizeTz && isValidTimeZone(localizeTz)) return localizeTz;
  } catch {
    // ignore
  }

  try {
    const intlTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (intlTz && isValidTimeZone(intlTz)) return intlTz;
  } catch {
    // ignore
  }

  return undefined;
};

const tryFormatIntl = (
  date: Date,
  locale: string,
  options: ExtendedDateTimeFormatOptions,
): string => {
  try {
    return new Intl.DateTimeFormat(locale, options).format(date);
  } catch {
    return '';
  }
};

const tryFormatLocaleString = (
  date: Date,
  locale: string,
  options: ExtendedDateTimeFormatOptions,
): string => {
  try {
    return sanitizeFormattedDateOutput(date.toLocaleString(locale, options));
  } catch {
    return '';
  }
};

const tryFormatLocaleDateTimeParts = (
  date: Date,
  locale: string,
  timeZone?: string,
): string => {
  try {
    const datePart = sanitizeFormattedDateOutput(
      date.toLocaleDateString(locale, {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        ...(timeZone ? { timeZone } : {}),
      }),
    );
    const timePart = sanitizeFormattedDateOutput(
      date.toLocaleTimeString(locale, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        ...(timeZone ? { timeZone } : {}),
      }),
    );
    if (!datePart || !timePart) return '';
    return sanitizeFormattedDateOutput(`${datePart} ${timePart}`);
  } catch {
    return '';
  }
};

const detectDateOrder = (locale: string): DateOrder => {
  try {
    const sample = new Date(Date.UTC(2006, 10, 22, 15, 16, 17));
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    }).formatToParts(sample);
    const order = parts
      .filter(part => part.type === 'day' || part.type === 'month' || part.type === 'year')
      .map(part => part.type)
      .join('');
    if (order === 'monthdayyear') return 'MDY';
    if (order === 'yearmonthday') return 'YMD';
    if (order === 'daymonthyear') return 'DMY';
  } catch {
    // ignore
  }

  const safeLocale = String(locale || '').toLowerCase();
  if (safeLocale.startsWith('en-us') || safeLocale.startsWith('en-ph')) return 'MDY';
  if (
    safeLocale.startsWith('ja') ||
    safeLocale.startsWith('zh') ||
    safeLocale.startsWith('ko')
  ) {
    return 'YMD';
  }
  return 'DMY';
};

const detectHour12Preference = (locale: string): boolean => {
  try {
    const resolved = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions();
    if (typeof resolved.hour12 === 'boolean') return resolved.hour12;
  } catch {
    // ignore
  }
  const safeLocale = String(locale || '').toLowerCase();
  return safeLocale.startsWith('en-us') || safeLocale.startsWith('en-ph');
};

const extractNumericPartsWithIntl = (
  date: Date,
  locale: string,
  timeZone?: string,
): NumericDateTimeParts | null => {
  try {
    const parts = new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(date);

    const lookup: Record<string, string> = {};
    parts.forEach(part => {
      if (part.type === 'year' || part.type === 'month' || part.type === 'day' || part.type === 'hour' || part.type === 'minute' || part.type === 'second') {
        lookup[part.type] = part.value;
      }
    });

    if (
      !lookup.year ||
      !lookup.month ||
      !lookup.day ||
      !lookup.hour ||
      !lookup.minute ||
      !lookup.second
    ) {
      return null;
    }

    const yearNumeric = Number(lookup.year);
    const monthNumeric = Number(lookup.month);
    const dayNumeric = Number(lookup.day);
    const hourNumeric = Number(lookup.hour);
    const minuteNumeric = Number(lookup.minute);
    const secondNumeric = Number(lookup.second);
    if (
      !Number.isFinite(yearNumeric) ||
      !Number.isFinite(monthNumeric) ||
      !Number.isFinite(dayNumeric) ||
      !Number.isFinite(hourNumeric) ||
      !Number.isFinite(minuteNumeric) ||
      !Number.isFinite(secondNumeric)
    ) {
      return null;
    }

    return {
      year: normalizeYear2Digit(String(yearNumeric)),
      month: pad2(monthNumeric),
      day: pad2(dayNumeric),
      hour: pad2(hourNumeric),
      minute: pad2(minuteNumeric),
      second: pad2(secondNumeric),
    };
  } catch {
    return null;
  }
};

const extractNumericPartsFromDate = (date: Date): NumericDateTimeParts => ({
  year: normalizeYear2Digit(String(date.getFullYear())),
  month: pad2(date.getMonth() + 1),
  day: pad2(date.getDate()),
  hour: pad2(date.getHours()),
  minute: pad2(date.getMinutes()),
  second: pad2(date.getSeconds()),
});

const buildManualLocalizedDateTime = (
  parts: NumericDateTimeParts,
  dateOrder: DateOrder,
  useHour12: boolean,
): string => {
  const hour24 = Number(parts.hour);
  const safeHour24 = Number.isFinite(hour24) ? Math.max(0, Math.min(23, hour24)) : 0;
  const hour12 = safeHour24 % 12 || 12;
  const suffix = safeHour24 >= 12 ? 'PM' : 'AM';
  const timeText = useHour12
    ? `${pad2(hour12)}:${parts.minute}:${parts.second} ${suffix}`
    : `${parts.hour}:${parts.minute}:${parts.second}`;

  if (dateOrder === 'MDY') {
    return `${parts.month}/${parts.day}/${parts.year} ${timeText}`;
  }
  if (dateOrder === 'YMD') {
    return `${parts.year}/${parts.month}/${parts.day} ${timeText}`;
  }
  return `${parts.day}/${parts.month}/${parts.year} ${timeText}`;
};

const tryFormatManualDateTimeFallback = (
  date: Date,
  locale: string,
  timeZone?: string,
): string => {
  const dateOrder = detectDateOrder(locale);
  const useHour12 = detectHour12Preference(locale);
  const numericParts =
    extractNumericPartsWithIntl(date, locale, timeZone) ||
    extractNumericPartsWithIntl(date, locale) ||
    extractNumericPartsFromDate(date);
  return sanitizeFormattedDateOutput(
    buildManualLocalizedDateTime(numericParts, dateOrder, useHour12),
  );
};

const formatWithFallbacks = ({
  date,
  locale,
  timeZone,
  options,
}: {
  date: Date;
  locale: string;
  timeZone?: string | null;
  options: ExtendedDateTimeFormatOptions;
}): string => {
  const normalizedOptions = { ...(options || {}) };
  const safeTimeZone = String(timeZone || '').trim();

  if (safeTimeZone) {
    const withLocaleAndTz = tryFormatIntl(date, locale, {
      ...normalizedOptions,
      timeZone: safeTimeZone,
    });
    if (withLocaleAndTz) return withLocaleAndTz;
  }

  const withLocale = tryFormatIntl(date, locale, normalizedOptions);
  if (withLocale) return withLocale;

  if (locale !== DEFAULT_LOCALE && safeTimeZone) {
    const withDefaultAndTz = tryFormatIntl(date, DEFAULT_LOCALE, {
      ...normalizedOptions,
      timeZone: safeTimeZone,
    });
    if (withDefaultAndTz) return withDefaultAndTz;
  }

  if (locale !== DEFAULT_LOCALE) {
    const withDefault = tryFormatIntl(date, DEFAULT_LOCALE, normalizedOptions);
    if (withDefault) return withDefault;
  }

  return '';
};

export const formatDate = (
  value: DateLike,
  locale?: string | null,
  timeZone?: string | null,
  options?: ExtendedDateTimeFormatOptions,
): string => {
  const date = normalizeDateTimeInput(value);
  if (!date) return '';
  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const hasDateStyle = typeof options?.dateStyle !== 'undefined';
  const hasDateParts =
    typeof options?.year !== 'undefined' ||
    typeof options?.month !== 'undefined' ||
    typeof options?.day !== 'undefined' ||
    typeof options?.weekday !== 'undefined' ||
    typeof options?.era !== 'undefined';
  const normalizedOptions: ExtendedDateTimeFormatOptions = {
    ...(!hasDateStyle && !hasDateParts
      ? { year: '2-digit', month: '2-digit', day: '2-digit' }
      : {}),
    ...(options || {}),
  };

  return (
    formatWithFallbacks({
      date,
      locale: resolvedLocale,
      timeZone: resolvedTimeZone,
      options: normalizedOptions,
    }) || ''
  );
};

export const formatTime = (
  value: DateLike,
  locale?: string | null,
  timeZone?: string | null,
  options?: ExtendedDateTimeFormatOptions,
): string => {
  const date = normalizeDateTimeInput(value);
  if (!date) return '';
  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const hasTimeStyle = typeof options?.timeStyle !== 'undefined';
  const hasTimeParts =
    typeof options?.hour !== 'undefined' ||
    typeof options?.minute !== 'undefined' ||
    typeof options?.second !== 'undefined' ||
    typeof options?.dayPeriod !== 'undefined' ||
    typeof options?.fractionalSecondDigits !== 'undefined' ||
    typeof options?.timeZoneName !== 'undefined' ||
    typeof options?.hourCycle !== 'undefined' ||
    typeof options?.hour12 !== 'undefined';
  const normalizedOptions: ExtendedDateTimeFormatOptions = {
    ...(!hasTimeStyle && !hasTimeParts ? { hour: '2-digit', minute: '2-digit' } : {}),
    ...(options || {}),
  };

  return (
    formatWithFallbacks({
      date,
      locale: resolvedLocale,
      timeZone: resolvedTimeZone,
      options: normalizedOptions,
    }) || ''
  );
};

export const formatDateTime = (
  value: DateLike,
  locale?: string | null,
  timeZone?: string | null,
  options?: ExtendedDateTimeFormatOptions,
): string => {
  const date = normalizeDateTimeInput(value);
  if (!date) return '';
  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const optionsRecord = options as Record<string, unknown> | undefined;
  const hasStyle =
    typeof options?.dateStyle !== 'undefined' || typeof options?.timeStyle !== 'undefined';
  const hasExplicitParts = DATE_TIME_OPTION_KEYS.some(
    key => typeof optionsRecord?.[key] !== 'undefined',
  );
  const normalizedOptions: ExtendedDateTimeFormatOptions = {
    ...(!hasStyle && !hasExplicitParts
      ? {
          year: '2-digit',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }
      : {}),
    ...(options || {}),
  };

  const formatted =
    formatWithFallbacks({
      date,
      locale: resolvedLocale,
      timeZone: resolvedTimeZone,
      options: normalizedOptions,
    }) || '';

  const sanitizedFormatted = sanitizeFormattedDateOutput(formatted);
  if (sanitizedFormatted) return sanitizedFormatted;

  // Guard rail: some runtimes may leak native Date.toString()-like output.
  // Rebuild using separate date/time formatters to keep locale ordering.
  const datePart = formatDate(date, resolvedLocale, resolvedTimeZone, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  });
  const timePart = formatTime(date, resolvedLocale, resolvedTimeZone, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  if (datePart && timePart) return sanitizeFormattedDateOutput(`${datePart} ${timePart}`);

  // Last-resort fallback for runtimes with partial/buggy Intl output.
  const manualFallback = tryFormatManualDateTimeFallback(date, resolvedLocale, resolvedTimeZone);
  if (manualFallback) return manualFallback;

  return '';
};

export const formatUpdatedAtDisplay = (
  value: unknown,
  locale?: string | null,
  timeZone?: string | null,
): string => {
  const normalized = normalizeToIsoDateTime(value);
  if (!normalized) return '';

  const date = normalizeDateTimeInput(normalized);
  if (!date) return '';

  const resolvedLocale = resolveLocale(locale);
  const resolvedTimeZone = resolveTimeZone(timeZone);
  const deviceLocale = resolveLocale(getLocales()?.[0]?.languageTag || DEFAULT_LOCALE);

  const attempts: Array<() => string> = [
    () => formatDateTime(date, resolvedLocale, resolvedTimeZone, UPDATED_AT_BASE_OPTIONS),
    () => formatDateTime(date, resolvedLocale, undefined, UPDATED_AT_BASE_OPTIONS),
    () => formatDateTime(date, deviceLocale, resolvedTimeZone, UPDATED_AT_BASE_OPTIONS),
    () => formatDateTime(date, deviceLocale, undefined, UPDATED_AT_BASE_OPTIONS),
    () =>
      tryFormatLocaleString(date, resolvedLocale, {
        ...UPDATED_AT_BASE_OPTIONS,
        ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
      }),
    () => tryFormatLocaleString(date, resolvedLocale, UPDATED_AT_BASE_OPTIONS),
    () =>
      tryFormatLocaleString(date, deviceLocale, {
        ...UPDATED_AT_BASE_OPTIONS,
        ...(resolvedTimeZone ? { timeZone: resolvedTimeZone } : {}),
      }),
    () => tryFormatLocaleString(date, deviceLocale, UPDATED_AT_BASE_OPTIONS),
    () => tryFormatLocaleDateTimeParts(date, resolvedLocale, resolvedTimeZone),
    () => tryFormatLocaleDateTimeParts(date, resolvedLocale),
    () => tryFormatLocaleDateTimeParts(date, deviceLocale, resolvedTimeZone),
    () => tryFormatLocaleDateTimeParts(date, deviceLocale),
  ];

  for (const attempt of attempts) {
    const formatted = sanitizeFormattedDateOutput(attempt());
    if (formatted) return formatted;
  }

  const manualAttempts = [
    tryFormatManualDateTimeFallback(date, resolvedLocale, resolvedTimeZone),
    tryFormatManualDateTimeFallback(date, resolvedLocale),
    tryFormatManualDateTimeFallback(date, deviceLocale, resolvedTimeZone),
    tryFormatManualDateTimeFallback(date, deviceLocale),
  ];
  for (const attempt of manualAttempts) {
    const formatted = sanitizeFormattedDateOutput(attempt);
    if (formatted) return formatted;
  }

  return '';
};
