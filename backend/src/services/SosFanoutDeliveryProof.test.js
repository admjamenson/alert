const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProofPayload,
  createSosFanoutDeliveryProofRunner,
} = require('./SosFanoutDeliveryProof');

test('SOS fan-out delivery proof runner waits for the real worker settlement', async () => {
  const calls = [];
  const runner = createSosFanoutDeliveryProofRunner({
    dispatcher: {
      async dispatch(payload) {
        calls.push(payload);
        return {
          mode: 'queue',
          queued: true,
          sentInline: false,
          jobId: 'proof-job-1',
        };
      },
    },
    queue: {
      async waitForResult(id) {
        assert.equal(id, 'proof-job-1');
        return {
          state: 'completed',
          failedReason: null,
          attemptsMade: 1,
          finishedOn: '2026-04-28T18:00:00.000Z',
          result: {
            deliveredCount: 2,
            deliveryMode: 'controlled_proof_sink',
            handlerId: 'createSosFanoutHandler',
          },
        };
      },
    },
  });

  const result = await runner.run({ probeIdPrefix: 'render-http' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].proofOfDelivery.probeId.startsWith('render-http:'), true);
  assert.equal(result.ok, true);
  assert.equal(result.deliveredCount, 2);
  assert.equal(result.deliveryMode, 'controlled_proof_sink');
  assert.equal(result.handlerId, 'createSosFanoutHandler');
});

test('SOS fan-out delivery proof runner does not count queued-only as delivery', async () => {
  const runner = createSosFanoutDeliveryProofRunner({
    dispatcher: {
      async dispatch() {
        return {
          mode: 'queue',
          queued: true,
          sentInline: false,
          jobId: 'proof-job-2',
        };
      },
    },
    queue: {
      async waitForResult() {
        return {
          state: 'completed',
          failedReason: null,
          attemptsMade: 1,
          finishedOn: '2026-04-28T18:00:00.000Z',
          result: {
            deliveredCount: 0,
            deliveryMode: 'push_provider',
            handlerId: 'createSosFanoutHandler',
          },
        };
      },
    },
  });

  const result = await runner.run();

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'proof_settlement_invalid');
  assert.equal(result.deliveredCount, 0);
});

test('SOS fan-out delivery proof runner keeps the synthetic payload safe', () => {
  const payload = buildProofPayload({
    probeId: 'Render Proof',
    tokenCount: 2,
  });

  assert.equal(payload.fromId, 'proof-sender');
  assert.equal(payload.fromName, 'Alert Proof');
  assert.equal(payload.message, 'sos-fanout-delivery-proof');
  assert.equal(payload.location.latitude, 0);
  assert.equal(payload.tokens.length, 2);
  assert.equal(payload.proofOfDelivery.probeId, 'Render Proof');
});
