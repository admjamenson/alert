const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRelaySosLogEntry,
  buildRelaySosRequestId,
  sanitizeErrorCode,
} = require('./relaySosOperationalLogger');

test('buildRelaySosLogEntry keeps only safe operational SOS fields', () => {
  const entry = buildRelaySosLogEntry('relay_sos_request_accepted', {
    requestId: 'req-123',
    relayId: 'relay-456',
    route: '/api/relay/sos',
    method: 'post',
    statusCode: 200,
    accepted: true,
    queued: false,
    fallbackUsed: false,
    errorCode: 'internal',
    durationMs: 321.2,
    payload: { contacts: [{ phone: '+55119999' }] },
    token: 'secret',
  });

  assert.equal(entry.event, 'relay_sos_request_accepted');
  assert.equal(entry.requestId, 'req-123');
  assert.equal(entry.relayId, 'relay-456');
  assert.equal(entry.route, '/api/relay/sos');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.accepted, true);
  assert.equal(entry.queued, false);
  assert.equal(entry.fallbackUsed, false);
  assert.equal(entry.errorCode, 'internal');
  assert.equal(entry.durationMs, 321);
  assert.ok(entry.timestamp);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'payload'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'token'), false);
});

test('buildRelaySosRequestId reuses safe IDs and generates fallback IDs', () => {
  assert.equal(buildRelaySosRequestId(' render:req-1 '), 'render:req-1');
  assert.match(buildRelaySosRequestId(''), /^[a-f0-9-]{36}$/i);
});

test('sanitizeErrorCode strips unsafe characters', () => {
  assert.equal(
    sanitizeErrorCode('Integrity mismatch: contacts[0].phone'),
    'integrity_mismatch:_contacts_0__phone',
  );
});
