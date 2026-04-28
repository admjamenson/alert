const test = require('node:test');
const assert = require('node:assert/strict');

const { __test__ } = require('./meteoAdapter');

test('GDACS item filter keeps only supported recent hazard types', () => {
  const now = new Date('2026-04-28T00:00:00.000Z');

  assert.equal(
    __test__.includeGdacsItem(
      {
        properties: {
          eventtype: 'FL',
          todate: '2026-04-25T10:00:00Z',
        },
      },
      now,
    ),
    true,
  );
  assert.equal(
    __test__.includeGdacsItem(
      {
        properties: {
          eventtype: 'EQ',
          todate: '2026-04-25T10:00:00Z',
        },
      },
      now,
    ),
    false,
  );
  assert.equal(
    __test__.includeGdacsItem(
      {
        properties: {
          eventtype: 'FL',
          todate: '2025-12-01T10:00:00Z',
        },
      },
      now,
    ),
    false,
  );
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
