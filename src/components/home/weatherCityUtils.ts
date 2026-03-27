export const toCityOnlyLabel = (raw?: string | null): string => {
  if (!raw) return '';
  const normalized = String(raw).trim();
  if (!normalized) return '';
  return normalized
    .split(',')[0]
    .replace(/\s+/g, ' ')
    .trim();
};

export const isUsableWeatherCityName = (
  raw: string | null | undefined,
  blockedLabels: string[],
): boolean => {
  const normalized = toCityOnlyLabel(raw);
  if (!normalized || normalized === '...') return false;
  return !blockedLabels.includes(normalized);
};
