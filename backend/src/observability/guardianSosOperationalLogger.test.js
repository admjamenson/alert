const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildGuardianSosLogEntry,
  buildGuardianSosRequestId,
  sanitizeErrorCode,
} = require('./guardianSosOperationalLogger');

test('buildGuardianSosLogEntry keeps only safe direct SOS operational fields', () => {
  const entry = buildGuardianSosLogEntry('guardian_sos_request_accepted', {
    requestId: 'req-123',
    jobId: 'job-456',
    route: '/api/sos',
    method: 'post',
    statusCode: 200,
    accepted: true,
    queued: true,
    fallbackUsed: false,
    errorCode: 'internal',
    durationMs: 321.2,
    payload: { contacts: [{ phone: '+55119999' }] },
    token: 'secret',
  });

  assert.equal(entry.event, 'guardian_sos_request_accepted');
  assert.equal(entry.requestId, 'req-123');
  assert.equal(entry.jobId, 'job-456');
  assert.equal(entry.route, '/api/sos');
  assert.equal(entry.method, 'POST');
  assert.equal(entry.statusCode, 200);
  assert.equal(entry.accepted, true);
  assert.equal(entry.queued, true);
  assert.equal(entry.fallbackUsed, false);
  assert.equal(entry.errorCode, 'internal');
  assert.equal(entry.durationMs, 321);
  assert.ok(entry.timestamp);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'payload'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(entry, 'token'), false);
});

test('buildGuardianSosRequestId reuses safe IDs and generates fallback IDs', () => {
  assert.equal(buildGuardianSosRequestId(' direct:req-1 '), 'direct:req-1');
  assert.match(buildGuardianSosRequestId(''), /^[a-f0-9-]{36}$/i);
});

test('guardian sanitizeErrorCode strips unsafe characters', () => {
  assert.equal(
    sanitizeErrorCode('Fanout timeout: tokens[0].phone'),
    'fanout_timeout:_tokens_0__phone',
  );
});
