type UrlValue = unknown;

const normalizeScalar = (value: UrlValue): string => {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
};

const pushEncodedPair = (
  pairs: string[],
  key: string,
  value: UrlValue,
) => {
  const normalized = normalizeScalar(value);
  if (!normalized) return;
  pairs.push(
    `${encodeURIComponent(key)}=${encodeURIComponent(normalized)}`,
  );
};

export const toUrlEncodedString = (
  params?: Record<string, UrlValue>,
): string => {
  if (!params) return '';
  const pairs: string[] = [];
  Object.entries(params).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach(item => pushEncodedPair(pairs, key, item));
      return;
    }
    pushEncodedPair(pairs, key, value);
  });
  return pairs.join('&');
};
