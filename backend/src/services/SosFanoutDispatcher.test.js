const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSosDeliveryProofTokens,
  DELIVERY_PROOF_HANDLER_ID,
  buildSosPushMessage,
  createSosFanoutDispatcher,
  createSosFanoutHandler,
} = require('./SosFanoutDispatcher');

const samplePayload = () => ({
  fromId: 'user-a',
  fromName: 'Ana',
  message: 'Preciso de ajuda',
  location: { latitude: -23.55, longitude: -46.63 },
  targets: ['guardian-b'],
  tokens: ['token-1'],
  timestamp: '2026-04-18T12:00:00.000Z',
});

test('SOS fan-out dispatches through the configured queue without inline push', async () => {
  const enqueued = [];
  let inlineCalls = 0;
  const dispatcher = createSosFanoutDispatcher({
    queue: {
      async enqueue(id, payload) {
        enqueued.push({ id, payload });
        return { accepted: true, deduped: false, id };
      },
    },
    sendInline: async () => {
      inlineCalls += 1;
    },
  });

  const result = await dispatcher.dispatch(samplePayload());

  assert.equal(result.mode, 'queue');
  assert.equal(result.queued, true);
  assert.equal(result.sentInline, false);
  assert.equal(result.tokenCount, 1);
  assert.equal(inlineCalls, 0);
  assert.equal(enqueued.length, 1);
  assert.equal(enqueued[0].payload.message, 'Preciso de ajuda');
});

test('SOS fan-out falls back inline if queue enqueue fails', async () => {
  const inlinePayloads = [];
  const dispatcher = createSosFanoutDispatcher({
    queue: {
      async enqueue() {
        throw new Error('redis_unavailable');
      },
    },
    sendInline: async payload => {
      inlinePayloads.push(payload);
    },
    logger: { error: () => {} },
  });

  const result = await dispatcher.dispatch(samplePayload());

  assert.equal(result.mode, 'inline_fallback');
  assert.equal(result.queued, false);
  assert.equal(result.sentInline, true);
  assert.equal(inlinePayloads.length, 1);
  assert.deepEqual(inlinePayloads[0].tokens, ['token-1']);
});

test('SOS fan-out falls back inline if queue enqueue times out', async () => {
  const inlinePayloads = [];
  const dispatcher = createSosFanoutDispatcher({
    queue: {
      async enqueue() {
        await new Promise(resolve => setTimeout(resolve, 320));
        return { accepted: true, id: 'late-job' };
      },
    },
    sendInline: async payload => {
      inlinePayloads.push(payload);
    },
    enqueueTimeoutMs: 5,
    logger: { error: () => {} },
  });

  const result = await dispatcher.dispatch(samplePayload());

  assert.equal(result.mode, 'inline_fallback');
  assert.equal(result.queued, false);
  assert.equal(result.sentInline, true);
  assert.equal(inlinePayloads.length, 1);
});

test('SOS fan-out handler builds the same push payload used by the product flow', async () => {
  const sent = [];
  const handler = createSosFanoutHandler({
    sendMulticast: async message => {
      sent.push(message);
      return { successCount: message.tokens.length, failureCount: 0 };
    },
  });

  const result = await handler(samplePayload());
  const built = buildSosPushMessage(samplePayload());

  assert.equal(result.ok, true);
  assert.equal(result.tokenCount, 1);
  assert.equal(result.successCount, 1);
  assert.equal(result.deliveryMode, 'push_provider');
  assert.equal(result.deliveredCount, null);
  assert.equal(result.handlerId, DELIVERY_PROOF_HANDLER_ID);
  assert.deepEqual(sent[0], built);
  assert.equal(sent[0].data.type, 'sos');
  assert.equal(sent[0].android.notification.channelId, 'alert_sos_channel');
  assert.equal(sent[0].apns.payload.aps.sound, 'alert_sos.wav');
});

test('SOS fan-out handler exposes controlled proof delivery without calling the push provider', async () => {
  let sendMulticastCalls = 0;
  const proofTokens = buildSosDeliveryProofTokens('render-smoke', 2);
  const handler = createSosFanoutHandler({
    sendMulticast: async () => {
      sendMulticastCalls += 1;
      return { successCount: 99, failureCount: 0 };
    },
  });

  const result = await handler({
    ...samplePayload(),
    proofOfDelivery: {
      probeId: 'render-smoke',
    },
    tokens: proofTokens,
  });

  assert.equal(sendMulticastCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.tokenCount, 2);
  assert.equal(result.successCount, 2);
  assert.equal(result.failureCount, 0);
  assert.equal(result.deliveredCount, 2);
  assert.equal(result.deliveryMode, 'controlled_proof_sink');
  assert.equal(result.handlerId, DELIVERY_PROOF_HANDLER_ID);
  assert.equal(result.proof.probeId, 'render-smoke');
});
