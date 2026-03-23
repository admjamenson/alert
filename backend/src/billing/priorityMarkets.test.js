const test = require('node:test');
const assert = require('node:assert/strict');
const {
  compactSanitizedValue,
  resolveBillingMarket,
  sanitizeValue,
} = require('./priorityMarkets');

test('Hong Kong city normalizes to HK market and HKD currency', () => {
  const market = resolveBillingMarket({
    countryCode: 'CN',
    cityName: 'Hong Kong',
    locale: 'zh-HK',
  });

  assert.equal(market.countryCode, 'HK');
  assert.equal(market.currency, 'HKD');
  assert.equal(market.marketTier, 'priority_city');
});

test('priority city affects market key but not currency for US', () => {
  const market = resolveBillingMarket({
    countryCode: 'US',
    cityName: 'San Jose (CA)',
    locale: 'en-US',
  });

  assert.equal(market.currency, 'USD');
  assert.equal(market.marketTier, 'priority_city');
  assert.match(market.marketKey, /^US-san_jose$/);
});

test('priority city normalizes Washington D.C. variants into the same US market key', () => {
  const market = resolveBillingMarket({
    countryCode: 'US',
    cityName: 'Washington, D.C.',
    locale: 'en-US',
  });

  assert.equal(market.currency, 'USD');
  assert.equal(market.marketTier, 'priority_city');
  assert.equal(market.priorityCity, 'washington dc');
  assert.match(market.marketKey, /^US-washington_dc$/);
});

[
  {
    label: 'Sao Paulo preserves BRL and priority city tier',
    input: { countryCode: 'BR', cityName: 'Sao Paulo', locale: 'pt-BR' },
    expected: { countryCode: 'BR', currency: 'BRL', priorityCity: 'sao paulo' },
  },
  {
    label: 'Sao Paulo with accent preserves BRL and priority city tier',
    input: { countryCode: 'BR', cityName: 'São Paulo', locale: 'pt-BR' },
    expected: { countryCode: 'BR', currency: 'BRL', priorityCity: 'sao paulo' },
  },
  {
    label: "Xian maps to canonical Xi'an priority city",
    input: { countryCode: 'CN', cityName: 'Xian', locale: 'zh-CN' },
    expected: { countryCode: 'CN', currency: 'CNY', priorityCity: "xi'an" },
  },
  {
    label: "Xi'an keeps canonical priority city",
    input: { countryCode: 'CN', cityName: "Xi'an", locale: 'zh-CN' },
    expected: { countryCode: 'CN', currency: 'CNY', priorityCity: "xi'an" },
  },
  {
    label: 'HongKong compacts into HK priority city',
    input: { countryCode: 'CN', cityName: 'HongKong', locale: 'zh-HK' },
    expected: { countryCode: 'HK', currency: 'HKD', priorityCity: 'hong kong' },
  },
  {
    label: 'Washington DC matches canonical priority city without punctuation',
    input: { countryCode: 'US', cityName: 'Washington DC', locale: 'en-US' },
    expected: { countryCode: 'US', currency: 'USD', priorityCity: 'washington dc' },
  },
  {
    label: 'Washington, DC matches canonical priority city with comma',
    input: { countryCode: 'US', cityName: 'Washington, DC', locale: 'en-US' },
    expected: { countryCode: 'US', currency: 'USD', priorityCity: 'washington dc' },
  },
  {
    label: 'San Jose CA matches canonical priority city',
    input: { countryCode: 'US', cityName: 'San Jose CA', locale: 'en-US' },
    expected: { countryCode: 'US', currency: 'USD', priorityCity: 'san jose' },
  },
].forEach(({ label, input, expected }) => {
  test(label, () => {
    const market = resolveBillingMarket(input);

    assert.equal(market.countryCode, expected.countryCode);
    assert.equal(market.currency, expected.currency);
    assert.equal(market.marketTier, 'priority_city');
    assert.equal(market.priorityCity, expected.priorityCity);
  });
});

test('sanitizers keep compact variants stable for premium city matching', () => {
  assert.equal(sanitizeValue('São Paulo'), 'sao paulo');
  assert.equal(compactSanitizedValue('HongKong'), 'hongkong');
  assert.equal(compactSanitizedValue("Xi'an"), 'xian');
  assert.equal(compactSanitizedValue('Washington, D.C.'), 'washingtondc');
});

test('non-priority city falls back to country tier', () => {
  const market = resolveBillingMarket({
    countryCode: 'AU',
    cityName: 'Adelaide',
    locale: 'en-AU',
  });

  assert.equal(market.currency, 'AUD');
  assert.equal(market.marketTier, 'country');
  assert.equal(market.marketKey, 'AU-AUD');
});
