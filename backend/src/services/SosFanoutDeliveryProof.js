const {
  buildSosDeliveryProofTokens,
  DELIVERY_PROOF_HANDLER_ID,
} = require('./SosFanoutDispatcher');

const readPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
};

const sanitizeProbeIdSegment = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);

const buildProofProbeId = prefix => {
  const safePrefix = sanitizeProbeIdSegment(prefix) || 'ops';
  return `${safePrefix}:${Date.now()}`;
};

const buildProofPayload = ({ probeId, tokenCount = 2 }) => ({
  fromId: 'proof-sender',
  fromName: 'Alert Proof',
  message: 'sos-fanout-delivery-proof',
  location: { latitude: 0, longitude: 0 },
  targets: [`proof-target:${probeId}`],
  tokens: buildSosDeliveryProofTokens(probeId, tokenCount),
  timestamp: new Date().toISOString(),
  proofOfDelivery: {
    probeId,
  },
});

const createSosFanoutDeliveryProofRunner = ({
  dispatcher,
  queue,
} = {}) => {
  if (!dispatcher || typeof dispatcher.dispatch !== 'function') {
    throw new Error('sos_fanout_dispatcher_required');
  }

  return {
    async run({
      probeIdPrefix = 'ops',
      tokenCount = 2,
      timeoutMs = 20_000,
      pollIntervalMs = 200,
    } = {}) {
      const probeId = buildProofProbeId(probeIdPrefix);
      const payload = buildProofPayload({
        probeId,
        tokenCount: readPositiveInt(tokenCount, 2),
      });
      const dispatchResult = await dispatcher.dispatch(payload);
      const queued =
        dispatchResult?.mode === 'queue' &&
        dispatchResult?.queued === true &&
        String(dispatchResult?.jobId || '').trim().length > 0;

      if (!queued) {
        return {
          ok: false,
          reason: 'proof_not_queued',
          probeId,
          dispatch: {
            mode: dispatchResult?.mode || 'unknown',
            queued: Boolean(dispatchResult?.queued),
            sentInline: Boolean(dispatchResult?.sentInline),
            jobId: dispatchResult?.jobId || null,
          },
          settlement: null,
          deliveredCount: 0,
          deliveryMode: null,
          handlerId: null,
        };
      }

      if (!queue || typeof queue.waitForResult !== 'function') {
        return {
          ok: false,
          reason: 'proof_queue_wait_unsupported',
          probeId,
          dispatch: {
            mode: dispatchResult.mode,
            queued: true,
            sentInline: false,
            jobId: dispatchResult.jobId,
          },
          settlement: null,
          deliveredCount: 0,
          deliveryMode: null,
          handlerId: null,
        };
      }

      const settlement = await queue.waitForResult(dispatchResult.jobId, {
        timeoutMs: readPositiveInt(timeoutMs, 20_000),
        pollIntervalMs: readPositiveInt(pollIntervalMs, 200),
      });
      const deliveredCount = Number(settlement?.result?.deliveredCount || 0);
      const ok =
        settlement?.state === 'completed' &&
        settlement?.result?.deliveryMode === 'controlled_proof_sink' &&
        settlement?.result?.handlerId === DELIVERY_PROOF_HANDLER_ID &&
        deliveredCount > 0;

      return {
        ok,
        reason: ok
          ? null
          : settlement
            ? 'proof_settlement_invalid'
            : 'proof_settlement_missing',
        probeId,
        dispatch: {
          mode: dispatchResult.mode,
          queued: true,
          sentInline: false,
          jobId: dispatchResult.jobId,
        },
        settlement: settlement
          ? {
              state: settlement.state,
              failedReason: settlement.failedReason || null,
              attemptsMade: Number(settlement.attemptsMade || 0),
              finishedOn: settlement.finishedOn || null,
            }
          : null,
        deliveredCount,
        deliveryMode: settlement?.result?.deliveryMode || null,
        handlerId: settlement?.result?.handlerId || null,
      };
    },
  };
};

module.exports = {
  buildProofPayload,
  buildProofProbeId,
  createSosFanoutDeliveryProofRunner,
  sanitizeProbeIdSegment,
};
