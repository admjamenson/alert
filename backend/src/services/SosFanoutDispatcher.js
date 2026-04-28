const crypto = require('node:crypto');

const normalizeTokens = tokens =>
  Array.isArray(tokens)
    ? tokens
        .map(token => String(token || '').trim())
        .filter(token => token.length > 0)
    : [];

const DELIVERY_PROOF_TOKEN_PREFIX = 'proof:sos-fanout:';
const DELIVERY_PROOF_HANDLER_ID = 'createSosFanoutHandler';

const sanitizeDeliveryProofProbeId = value =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);

const buildSosDeliveryProofTokens = (probeId, count = 1) => {
  const safeProbeId = sanitizeDeliveryProofProbeId(probeId);
  const safeCount = Math.max(1, Math.min(10, Math.round(Number(count) || 1)));
  if (!safeProbeId) {
    throw new Error('sos_delivery_proof_probe_id_required');
  }

  return Array.from({ length: safeCount }, (_value, index) => {
    return `${DELIVERY_PROOF_TOKEN_PREFIX}${safeProbeId}:${index + 1}`;
  });
};

const resolveDeliveryProofProbe = ({ payload, tokens }) => {
  const safeProbeId = sanitizeDeliveryProofProbeId(payload?.proofOfDelivery?.probeId);
  if (!safeProbeId || tokens.length === 0) {
    return null;
  }

  const allTokensMatch = tokens.every((token, index) => {
    return token === `${DELIVERY_PROOF_TOKEN_PREFIX}${safeProbeId}:${index + 1}`;
  });

  if (!allTokensMatch) {
    return null;
  }

  return {
    probeId: safeProbeId,
    deliveryMode: 'controlled_proof_sink',
  };
};

const buildSosPushMessage = ({
  tokens,
  fromName,
  message,
  location,
  timestamp,
}) => {
  const safeFromName = String(fromName || 'Guardiao');
  const safeMessage = String(message || '');
  const safeTimestamp = String(timestamp || new Date().toISOString());
  const normalizedTokens = normalizeTokens(tokens);

  return {
    tokens: normalizedTokens,
    data: {
      type: 'sos',
      senderName: safeFromName,
      message: safeMessage,
      location: location ? JSON.stringify(location) : '',
      timestamp: safeTimestamp,
    },
    notification: {
      title: 'SOS Alert',
      body: `${safeFromName} solicitou ajuda agora.`,
    },
    android: {
      notification: {
        channelId: 'alert_sos_channel',
        sound: 'alert_sos',
      },
    },
    apns: {
      payload: {
        aps: { sound: 'alert_sos.wav' },
      },
    },
  };
};

const buildSosFanoutJobId = ({ fromId, targets, timestamp }) => {
  const fingerprint = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        fromId: String(fromId || ''),
        targets: Array.isArray(targets) ? targets.map(String).sort() : [],
        timestamp: String(timestamp || ''),
      }),
    )
    .digest('hex')
    .slice(0, 24);

  return `sos-fanout:${fingerprint}`;
};

const readPositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const withTimeout = async (promise, timeoutMs, errorMessage) => {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(errorMessage)),
          Math.max(250, Number(timeoutMs || 1200)),
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

const createRedisConnectionFromUrl = (value, options = {}) => {
  if (!value) return undefined;
  const parsed = new URL(value);
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    tls: parsed.protocol === 'rediss:' ? {} : undefined,
    connectTimeout: readPositiveNumber(
      options.connectTimeoutMs || process.env.ALERT_REDIS_CONNECT_TIMEOUT_MS,
      2500,
    ),
    maxRetriesPerRequest: null,
  };
};

const createSosFanoutHandler = ({ sendMulticast }) => {
  if (typeof sendMulticast !== 'function') {
    throw new Error('sos_fanout_send_multicast_required');
  }

  return async payload => {
    const tokens = normalizeTokens(payload?.tokens);
    if (tokens.length === 0) {
      return {
        ok: true,
        skipped: 'no_tokens',
        tokenCount: 0,
        deliveredCount: 0,
        handlerId: DELIVERY_PROOF_HANDLER_ID,
      };
    }

    const deliveryProof = resolveDeliveryProofProbe({ payload, tokens });
    if (deliveryProof) {
      return {
        ok: true,
        tokenCount: tokens.length,
        successCount: tokens.length,
        failureCount: 0,
        deliveredCount: tokens.length,
        deliveryMode: deliveryProof.deliveryMode,
        handlerId: DELIVERY_PROOF_HANDLER_ID,
        proof: {
          probeId: deliveryProof.probeId,
          deliveredCount: tokens.length,
        },
      };
    }

    const response = await sendMulticast(
      buildSosPushMessage({
        ...payload,
        tokens,
      }),
    );

    return {
      ok: true,
      tokenCount: tokens.length,
      successCount:
        typeof response?.successCount === 'number' ? response.successCount : null,
      failureCount:
        typeof response?.failureCount === 'number' ? response.failureCount : null,
      deliveredCount: null,
      deliveryMode: 'push_provider',
      handlerId: DELIVERY_PROOF_HANDLER_ID,
    };
  };
};

const createSosFanoutDispatcher = ({
  queue,
  sendInline,
  logger = console,
  enqueueTimeoutMs = readPositiveNumber(
    process.env.ALERT_SOS_FANOUT_ENQUEUE_TIMEOUT_MS,
    1200,
  ),
} = {}) => {
  if (queue && typeof queue.enqueue !== 'function') {
    throw new Error('sos_fanout_queue_invalid');
  }
  if (typeof sendInline !== 'function') {
    throw new Error('sos_fanout_inline_sender_required');
  }

  const dispatch = async payload => {
    const tokens = normalizeTokens(payload?.tokens);
    if (tokens.length === 0) {
      return {
        mode: 'none',
        queued: false,
        sentInline: false,
        tokenCount: 0,
      };
    }

    const jobId = payload?.jobId || buildSosFanoutJobId(payload || {});
    if (queue) {
      try {
        const result = await withTimeout(
          queue.enqueue(jobId, {
            ...payload,
            tokens,
            jobId,
          }),
          enqueueTimeoutMs,
          'sos_fanout_enqueue_timeout',
        );
        return {
          mode: 'queue',
          queued: Boolean(result.accepted),
          deduped: Boolean(result.deduped),
          sentInline: false,
          tokenCount: tokens.length,
          jobId: result.id || jobId,
        };
      } catch (error) {
        logger.error('[sos/fanout] queue dispatch failed; falling back inline', {
          error: error?.message || String(error),
          jobId,
        });
      }
    }

    await sendInline({
      ...payload,
      tokens,
      jobId,
    });

    return {
      mode: queue ? 'inline_fallback' : 'inline',
      queued: false,
      sentInline: true,
      tokenCount: tokens.length,
      jobId,
    };
  };

  return { dispatch };
};

module.exports = {
  buildSosDeliveryProofTokens,
  buildSosFanoutJobId,
  buildSosPushMessage,
  createRedisConnectionFromUrl,
  createSosFanoutDispatcher,
  createSosFanoutHandler,
  DELIVERY_PROOF_HANDLER_ID,
  normalizeTokens,
};
