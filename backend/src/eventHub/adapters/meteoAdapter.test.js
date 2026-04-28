const test = require('node:test');
const assert = require('node:assert/strict');

const { __test__ } = require('./meteoAdapter');

test('GDACS search URL uses the current SEARCH endpoint with bounded filters', () => {
  const url = __test__.buildGdacsSearchUrl(new Date('2026-04-28T00:00:00.000Z'));

  assert.equal(
    url.startsWith(
      'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?',
    ),
    true,
  );
  assert.equal(url.includes('eventlist=FL%3BTC%3BWF%3BVO%3BTS%3BDR'), true);
  assert.equal(url.includes('alertlevel=green%3Borange%3Bred'), true);
  assert.equal(url.includes('pagesize=100'), true);
});

test('GDACS event parsing prefers structured report URLs and human titles', () => {
  const provider = {
    id: 'hydro_gdacs',
    trustTier: 'B',
    sourceClass: 'verified_partner',
    sourceAuthority: 0.82,
  };
  const item = {
    geometry: {
      coordinates: [-38.5736, -3.8198],
    },
    properties: {
      eventtype: 'FL',
      eventid: 1103757,
      name: 'Flood in Brazil',
      alertlevel: 'Green',
      fromdate: '2026-02-03T01:00:00',
      todate: '2026-04-19T01:00:00',
      iso3: 'BRA',
      url: {
        report:
          'https://www.gdacs.org/report.aspx?eventid=1103757&episodeid=28&eventtype=FL',
      },
    },
  };

  const events = __test__.createGdacsEventsForItem(item, provider);

  assert.equal(events.length > 0, true);
  assert.equal(events[0].source.referenceUrl.includes('report.aspx'), true);
  assert.equal(events[0].type, 'flood');
});
