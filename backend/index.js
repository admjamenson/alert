const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const crypto = require('crypto');
const zlib = require('zlib');
const { decode: decodeMsgpack } = require('@msgpack/msgpack');
const { validateRuntimeConfig } = require('./src/config/runtime');
const { createFirebaseState } = require('./src/bootstrap/firebaseAdmin');
const { resolveRequestIdentity } = require('./src/http/identity');
const registerEntitlementRoutes = require('./src/routes/registerEntitlementRoutes');
const registerFeedRoutes = require('./src/routes/registerFeedRoutes');
const registerMapsRoutes = require('./src/routes/registerMapsRoutes');
const { EventHubService } = require('./src/eventHub/EventHubService');
const { getProviderFetchMetrics } = require('./src/eventHub/fetcher');
const {
  bboxFromPoint,
  haversineKm,
  riskLevelFromCap,
  toMillis: toEventMillis,
} = require('./src/eventHub/utils');
const {
  registerStripeBilling,
} = require('./src/billing/registerStripeBilling');
const registerAppleBilling = require('./src/billing/registerAppleBilling');
const registerAppStoreNotifications = require('./src/billing/registerAppStoreNotifications');
const {
  buildSosPushMessage,
  createSosFanoutDispatcher,
} = require('./src/services/SosFanoutDispatcher');
const {
  buildRelaySosRequestId,
  logRelaySosEvent,
  sanitizeErrorCode,
} = require('./src/observability/relaySosOperationalLogger');
const {
  createExternalSosFanoutQueue,
} = require('./src/services/createSosFanoutQueue');

const runtimeConfig = (() => {
  try {
    return validateRuntimeConfig();
  } catch (error) {
    console.error('[bootstrap/config] runtime configuration invalid', error);
    process.exit(1);
  }
})();

const app = express();
app.use(cors());
app.use((req, res, next) => {
  if (
    req.originalUrl === '/webhook' ||
    req.originalUrl === '/webhooks/stripe'
  ) {
    return express.raw({ type: 'application/json', limit: '2mb' })(
      req,
      res,
      next,
    );
  }
  return express.urlencoded({ extended: true, limit: '2mb' })(req, res, () =>
    express.json({ limit: '2mb' })(req, res, next),
  );
});

const FIREBASE_OPTIONAL_ROUTE_PATTERNS = [
  /^\/$/,
  /^\/healthz$/,
  /^\/api\/me\/entitlements$/,
  /^\/api\/v1\/meta\/countries$/,
  /^\/api\/v1\/weather\/feed$/,
  /^\/api\/v1\/epidemic\/feed$/,
  /^\/api\/v1\/risk\/feed$/,
  /^\/api\/v1\/maps\/geocode\/autocomplete$/,
  /^\/api\/v1\/maps\/geocode\/search$/,
  /^\/api\/v1\/maps\/geocode\/reverse$/,
  /^\/api\/v1\/maps\/routes$/,
  /^\/api\/relay\/ping$/,
  /^\/api\/relay\/metrics$/,
  /^\/v1\/meta\/countries$/,
  /^\/v1\/epidemic\/feed$/,
  /^\/v1\/maps\/geocode\/autocomplete$/,
  /^\/v1\/maps\/routes$/,
  /^\/v1\/operational\/snapshot$/,
  /^\/v1\/events$/,
  /^\/v1\/health\/top$/,
  /^\/v1\/providers\/status$/,
  /^\/v1\/ops\/summary$/,
  /^\/favicon\.ico$/,
];

const STRIPE_BILLING_ROUTE_PATTERNS = [
  /^\/billing\/auth-token$/,
  /^\/billing\/config$/,
  /^\/account\/billing\.json$/,
  /^\/create-checkout-session$/,
  /^\/create-payment-intent$/,
  /^\/create-portal-session$/,
  /^\/webhook$/,
  /^\/webhooks\/stripe$/,
  /^\/checkout$/,
  /^\/success$/,
  /^\/cancel$/,
  /^\/account\/billing$/,
];

const APPLE_BILLING_ROUTE_PATTERNS = [
  /^\/sync-apple-purchase$/,
  /^\/restore-apple-purchases$/,
  /^\/apple-entitlement\/.+/,
];

const APPLE_NOTIFICATIONS_ROUTE_PATTERNS = [/^\/app-store-notifications$/];

const readPathname = req => String(req.path || req.originalUrl || '').split('?')[0];

const matchesAnyPattern = (pathname, patterns) =>
  patterns.some(pattern => pattern.test(pathname));

const buildServiceUnavailablePayload = ({ code, message, reason }) => ({
  error: code,
  message,
  meta: {
    generatedAt: new Date().toISOString(),
    failClosed: true,
    reason: reason || null,
  },
});

const firebaseState = createFirebaseState({ admin });
const db = firebaseState.db;

const serviceAvailability = {
  firebase: firebaseState.available,
  stripeBilling: false,
  appleBilling: false,
  appStoreNotifications: false,
  sosFanoutQueue: false,
  sosFanoutQueueDriver: null,
  sosFanoutQueueReason: null,
};

const registerServiceModule = (label, registerFn, availabilityKey, unavailableReason) => {
  try {
    registerFn();
    serviceAvailability[availabilityKey] = true;
    console.log(`[bootstrap/${label}] registered`);
  } catch (error) {
    serviceAvailability[availabilityKey] = false;
    console.error(
      `[bootstrap/${label}] unavailable: ${error.message}`,
    );
    if (!firebaseState.reason) {
      firebaseState.reason = unavailableReason || `${label}_registration_failed`;
    }
  }
};

if (db) {
  registerServiceModule(
    'stripe-billing',
    () => registerStripeBilling(app, { db }),
    'stripeBilling',
    'stripe_billing_registration_failed',
  );
  registerServiceModule(
    'apple-billing',
    () => registerAppleBilling(app, db),
    'appleBilling',
    'apple_billing_registration_failed',
  );
  registerServiceModule(
    'app-store-notifications',
    () => registerAppStoreNotifications(app, db),
    'appStoreNotifications',
    'app_store_notifications_registration_failed',
  );
} else {
  console.warn(
    `[bootstrap/firebase] Firebase-dependent modules were not registered because Firebase is unavailable (${firebaseState.reason}).`,
  );
}

app.get('/', (_req, res) => {
  return res.json({
    ok: true,
    service: 'alert-backend',
    firebaseAvailable: serviceAvailability.firebase,
    degraded: !serviceAvailability.firebase,
    generatedAt: new Date().toISOString(),
  });
});

app.get('/healthz', (_req, res) => {
  return res.status(200).json({
    ok: true,
    service: 'alert-backend',
    firebaseAvailable: serviceAvailability.firebase,
    degraded: !serviceAvailability.firebase,
    modules: {
      stripeBilling: serviceAvailability.stripeBilling,
      appleBilling: serviceAvailability.appleBilling,
      appStoreNotifications: serviceAvailability.appStoreNotifications,
      sosFanoutQueue: serviceAvailability.sosFanoutQueue,
      sosFanoutQueueDriver: serviceAvailability.sosFanoutQueueDriver,
      sosFanoutQueueReason: serviceAvailability.sosFanoutQueueReason,
    },
    reason: firebaseState.reason,
    generatedAt: new Date().toISOString(),
  });
});

app.use((req, res, next) => {
  const pathname = readPathname(req);

  if (
    !serviceAvailability.stripeBilling &&
    matchesAnyPattern(pathname, STRIPE_BILLING_ROUTE_PATTERNS)
  ) {
    return res.status(503).json(
      buildServiceUnavailablePayload({
        code: 'stripe_billing_unavailable',
        message:
          'Stripe billing is temporarily unavailable on this service.',
        reason: firebaseState.reason || 'stripe_billing_routes_unavailable',
      }),
    );
  }

  if (
    !serviceAvailability.appleBilling &&
    matchesAnyPattern(pathname, APPLE_BILLING_ROUTE_PATTERNS)
  ) {
    return res.status(503).json(
      buildServiceUnavailablePayload({
        code: 'apple_billing_unavailable',
        message:
          'Apple billing is temporarily unavailable on this service.',
        reason: firebaseState.reason || 'apple_billing_routes_unavailable',
      }),
    );
  }

  if (
    !serviceAvailability.appStoreNotifications &&
    matchesAnyPattern(pathname, APPLE_NOTIFICATIONS_ROUTE_PATTERNS)
  ) {
    return res.status(503).json(
      buildServiceUnavailablePayload({
        code: 'app_store_notifications_unavailable',
        message:
          'App Store notifications are temporarily unavailable on this service.',
        reason:
          firebaseState.reason || 'app_store_notifications_routes_unavailable',
      }),
    );
  }

  if (
    !serviceAvailability.firebase &&
    !matchesAnyPattern(pathname, FIREBASE_OPTIONAL_ROUTE_PATTERNS)
  ) {
    return res.status(503).json(
      buildServiceUnavailablePayload({
        code: 'firebase_unavailable',
        message:
          'Firebase Admin is not configured for this service. Set FIREBASE_SERVICE_ACCOUNT to enable Firebase-dependent routes.',
        reason: firebaseState.reason,
      }),
    );
  }

  return next();
});

registerEntitlementRoutes(app, {
  db,
  config: runtimeConfig,
  logger: console,
});

registerFeedRoutes(app, {
  db,
  config: runtimeConfig,
  logger: console,
});

registerMapsRoutes(app, {
  config: runtimeConfig,
  logger: console,
});

const clampPercent = value => Math.max(0, Math.min(100, Number(value || 0)));
const nowIso = () => new Date().toISOString();
const clampUnit = value => Math.max(0, Math.min(1, Number(value || 0)));

const GUARDIANS_CONVERSATION_ID = runtimeConfig.guardians.conversationId;
const RELAY_SECRET = runtimeConfig.relay.hmacSecret;
const RELAY_TOKEN_TTL_SEC = runtimeConfig.relay.tokenTtlSec;
const RELAY_MAX_CLOCK_SKEW_MS = runtimeConfig.relay.maxClockSkewMs;

const sendSosFanoutPush = payload =>
  admin.messaging().sendEachForMulticast(buildSosPushMessage(payload));

let sosFanoutQueue = null;
try {
  const sosQueueBootstrap = createExternalSosFanoutQueue({
    sendMulticast: sendSosFanoutPush,
    logger: console,
  });
  sosFanoutQueue = sosQueueBootstrap.queue;
  serviceAvailability.sosFanoutQueue = Boolean(sosQueueBootstrap.enabled);
  serviceAvailability.sosFanoutQueueDriver = sosQueueBootstrap.driver;
  serviceAvailability.sosFanoutQueueReason = sosQueueBootstrap.reason;
} catch (error) {
  serviceAvailability.sosFanoutQueue = false;
  serviceAvailability.sosFanoutQueueDriver = 'bullmq';
  serviceAvailability.sosFanoutQueueReason = error?.message || 'queue_bootstrap_failed';
  console.error('[sos/fanout] external queue unavailable', error);
  if (process.env.ALERT_REQUIRE_EXTERNAL_INFRA === 'true') {
    process.exit(1);
  }
}

const sosFanoutDispatcher = createSosFanoutDispatcher({
  queue: sosFanoutQueue,
  sendInline: sendSosFanoutPush,
  logger: console,
});

const relayRateWindow = new Map();
const replayNonceWindow = new Map();
const relayMetrics = {
  sos: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
  alertsPull: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
  chatSend: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
  chatMessages: { total: 0, success: 0, failed: 0, totalLatencyMs: 0 },
};

const base64Url = value =>
  Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const decodeBase64Url = value => {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '==='.slice((normalized.length + 3) % 4);
  return Buffer.from(padded, 'base64');
};

const signRelayToken = data =>
  base64Url(crypto.createHmac('sha256', RELAY_SECRET).update(data).digest());

const createRelayToken = payload => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = signRelayToken(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
};

const verifyRelayToken = token => {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) {
    throw new Error('relay_token_format');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expectedSignature = signRelayToken(
    `${encodedHeader}.${encodedPayload}`,
  );
  const signatureBuffer = Buffer.from(encodedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error('relay_token_signature');
  }

  const payload = JSON.parse(decodeBase64Url(encodedPayload).toString('utf8'));
  const nowSec = Math.floor(Date.now() / 1000);
  if (!payload?.exp || payload.exp <= nowSec) {
    throw new Error('relay_token_expired');
  }

  return payload;
};

const enforceRelayRateLimit = (key, maxPerMinute) => {
  const now = Date.now();
  const current = relayRateWindow.get(key);

  if (!current || now - current.windowStart > 60_000) {
    relayRateWindow.set(key, { windowStart: now, count: 1 });
    return false;
  }

  current.count += 1;
  relayRateWindow.set(key, current);
  return current.count > maxPerMinute;
};

const consumeReplayNonce = (nonceKey, tsRaw) => {
  const now = Date.now();
  const timestamp = Number(tsRaw);

  if (!Number.isFinite(timestamp)) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  if (Math.abs(now - timestamp) > RELAY_MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'clock_skew' };
  }

  const existing = replayNonceWindow.get(nonceKey);
  if (existing && existing > now) {
    return { ok: false, reason: 'replay_detected' };
  }

  replayNonceWindow.set(nonceKey, now + RELAY_MAX_CLOCK_SKEW_MS);

  if (replayNonceWindow.size > 5000) {
    const cutoff = now - RELAY_MAX_CLOCK_SKEW_MS;
    for (const [key, expiresAt] of replayNonceWindow.entries()) {
      if (expiresAt < cutoff) replayNonceWindow.delete(key);
    }
  }

  return { ok: true };
};

const decodeRelayPayload = rawBody => {
  if (!rawBody || typeof rawBody !== 'object') return null;

  if (
    rawBody.encoding === 'msgpack+gzip+base64' &&
    typeof rawBody.payload === 'string' &&
    rawBody.payload.length > 0
  ) {
    const compressed = Buffer.from(rawBody.payload, 'base64');
    const unpacked = zlib.gunzipSync(compressed);
    return decodeMsgpack(unpacked);
  }

  if (rawBody.payload && typeof rawBody.payload === 'object') {
    return rawBody.payload;
  }

  return rawBody;
};

const normalizeRelaySosContacts = contacts =>
  (Array.isArray(contacts) ? contacts : [])
    .map(item => ({
      id:
        item && typeof item.id === 'string' && item.id.trim().length > 0
          ? item.id.trim()
          : '',
      phone:
        item && typeof item.phone === 'string' && item.phone.trim().length > 0
          ? item.phone.trim()
          : '',
      name:
        item && typeof item.name === 'string' && item.name.trim().length > 0
          ? item.name.trim()
          : '',
      channel:
        item && (item.channel === 'guardian' || item.channel === 'contact')
          ? item.channel
          : 'contact',
    }))
    .filter(item => item.id || item.phone || item.name)
    .sort((left, right) => {
      const a = `${left.channel}|${left.id}|${left.phone}|${left.name}`;
      const b = `${right.channel}|${right.id}|${right.phone}|${right.name}`;
      return a.localeCompare(b);
    });

const buildRelaySosIntegritySource = payload =>
  JSON.stringify({
    id: typeof payload?.id === 'string' ? payload.id : '',
    location: {
      latitude: Number(payload?.location?.latitude ?? 0),
      longitude: Number(payload?.location?.longitude ?? 0),
    },
    contacts: normalizeRelaySosContacts(payload?.contacts),
    userName:
      typeof payload?.userName === 'string' ? payload.userName.trim() : '',
    createdAt:
      typeof payload?.createdAt === 'string' ? payload.createdAt.trim() : '',
    priority:
      typeof payload?.priority === 'string' && payload.priority.trim().length > 0
        ? payload.priority.trim()
        : 'high',
  });

const computeRelaySosIntegrityDigest = payload =>
  crypto
    .createHash('sha256')
    .update(buildRelaySosIntegritySource(payload))
    .digest('hex');

const markRelayMetric = (key, ok, latencyMs) => {
  const target = relayMetrics[key];
  if (!target) return;
  target.total += 1;
  if (ok) target.success += 1;
  else target.failed += 1;
  target.totalLatencyMs += Math.max(0, latencyMs);
};

const relayAuthMiddleware = (req, res, next) => {
  try {
    const authHeader = String(req.headers.authorization || '').trim();
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'missing_bearer_token' });
    }

    const token = authHeader.slice('Bearer '.length).trim();
    const payload = verifyRelayToken(token);

    const headerDeviceId = String(
      req.headers['x-alert-device-id'] || '',
    ).trim();
    if (!headerDeviceId || headerDeviceId !== payload.did) {
      return res.status(401).json({ error: 'device_binding_failed' });
    }

    const nonce = String(req.headers['x-alert-nonce'] || '').trim();
    const ts = String(req.headers['x-alert-ts'] || '').trim();
    if (!nonce || !ts) {
      return res.status(400).json({ error: 'missing_nonce_or_timestamp' });
    }

    const replay = consumeReplayNonce(
      `${payload.sub}:${payload.did}:${nonce}`,
      ts,
    );
    if (!replay.ok) {
      return res.status(409).json({ error: replay.reason });
    }

    req.relay = {
      userId: String(payload.sub),
      deviceId: String(payload.did),
      tokenId: String(payload.jti || ''),
    };

    return next();
  } catch (error) {
    return res.status(401).json({ error: 'relay_auth_failed' });
  }
};

const resolveIdentity = resolveRequestIdentity;

const sanitizeLimit = (value, fallback = 20, max = 50) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(max, Math.round(n)));
};

const toMillis = value => {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }
  if (typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }
  return 0;
};

const parseCursorMs = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
};

const normalizeChatType = value => {
  const raw = String(value || '').toLowerCase();
  if (raw === 'private' || raw === 'group' || raw === 'monitor') return raw;
  return 'group';
};

const normalizeMessageType = value => {
  const raw = String(value || '').toLowerCase();
  if (
    raw === 'text' ||
    raw === 'image' ||
    raw === 'video' ||
    raw === 'audio' ||
    raw === 'document'
  ) {
    return raw;
  }
  return 'text';
};

const previewFromMessage = payload => {
  const type = normalizeMessageType(payload.type);
  if (type === 'text') return String(payload.text || '').slice(0, 240) || '...';
  if (type === 'image') return '[image]';
  if (type === 'video') return '[video]';
  if (type === 'audio') return '[audio]';
  return '[document]';
};

app.post('/api/register-token', async (req, res) => {
  try {
    const { id, name, phone, fcmToken } = req.body || {};
    if (!id || !fcmToken)
      return res.status(400).json({ error: 'Missing id/token' });
    await db
      .collection('users')
      .doc(id)
      .set(
        {
          id,
          name: name || 'Usuario Alert',
          phone: phone || null,
          fcmToken,
          updatedAt: nowIso(),
        },
        { merge: true },
      );
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/chat/conversations', async (req, res) => {
  try {
    const identity = resolveIdentity(req);
    const limit = sanitizeLimit(req.query.limit, 30, 100);
    const cursorMs = parseCursorMs(req.query.cursor);

    const snapshot = await db
      .collection('conversations')
      .where('members', 'array-contains', identity.userId)
      .get();

    const all = snapshot.docs
      .map(doc => {
        const data = doc.data() || {};
        const updatedAtMs = toMillis(data.updatedAt);
        const last =
          data.lastMessage && typeof data.lastMessage === 'object'
            ? data.lastMessage
            : null;
        const isGuardians =
          doc.id === GUARDIANS_CONVERSATION_ID ||
          Boolean(data?.metadata?.isGuardians);
        return {
          id: doc.id,
          type: normalizeChatType(data.type),
          title:
            typeof data.title === 'string' && data.title.trim().length > 0
              ? data.title
              : isGuardians
              ? 'Guardioes'
              : doc.id,
          members: Array.isArray(data.members)
            ? data.members.filter(Boolean)
            : [],
          metadata: {
            isGuardians,
            conversationType: isGuardians ? 'GUARDIANS_GROUP' : undefined,
          },
          updatedAtMs,
          lastMessageAtMs: last ? toMillis(last.createdAt) : updatedAtMs,
          lastMessage: last
            ? {
                senderId:
                  typeof last.senderId === 'string' ? last.senderId : undefined,
                senderName:
                  typeof last.senderName === 'string'
                    ? last.senderName
                    : undefined,
                type: normalizeMessageType(last.type),
                text: typeof last.text === 'string' ? last.text : undefined,
                createdAtMs: toMillis(last.createdAt),
              }
            : undefined,
        };
      })
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

    const filtered = cursorMs
      ? all.filter(item => item.updatedAtMs < cursorMs)
      : all;
    const items = filtered.slice(0, limit);
    const nextCursor =
      items.length === limit ? items[items.length - 1].updatedAtMs : null;

    return res.json({
      ok: true,
      items,
      nextCursor,
      generatedAt: nowIso(),
    });
  } catch (error) {
    console.error('[chat/conversations]', error);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/chat/messages', async (req, res) => {
  try {
    const conversationId = String(req.query.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }
    const limit = sanitizeLimit(req.query.limit, 40, 120);
    const cursorMs = parseCursorMs(req.query.cursor);

    let query = db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (cursorMs) {
      query = query.where('createdAt', '<', new Date(cursorMs));
    }

    const snapshot = await query.get();
    const items = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return {
        id: doc.id,
        conversationId,
        senderId: typeof data.senderId === 'string' ? data.senderId : '',
        senderName: typeof data.senderName === 'string' ? data.senderName : '',
        type: normalizeMessageType(data.type),
        text: typeof data.text === 'string' ? data.text : undefined,
        uri: typeof data.uri === 'string' ? data.uri : undefined,
        meta:
          data.meta && typeof data.meta === 'object' ? data.meta : undefined,
        createdAtMs: toMillis(data.createdAt),
        updatedAtMs: toMillis(data.updatedAt) || toMillis(data.createdAt),
        clientNonce:
          typeof data.clientNonce === 'string' ? data.clientNonce : undefined,
        replyTo:
          data.replyTo && typeof data.replyTo === 'object'
            ? data.replyTo
            : undefined,
        reactions:
          data.reactions && typeof data.reactions === 'object'
            ? data.reactions
            : {},
        pinnedAtMs: data.pinnedAt ? toMillis(data.pinnedAt) : null,
        deletedAtMs: data.deletedAt ? toMillis(data.deletedAt) : null,
      };
    });

    const nextCursor =
      items.length === limit
        ? Number(items[items.length - 1].createdAtMs || 0)
        : null;

    return res.json({
      ok: true,
      items,
      nextCursor,
      generatedAt: nowIso(),
    });
  } catch (error) {
    console.error('[chat/messages]', error);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/chat/send', async (req, res) => {
  try {
    const identity = resolveIdentity(req);
    const body = req.body || {};
    const conversationId = String(body.conversationId || '').trim();
    if (!conversationId) {
      return res.status(400).json({ error: 'missing_conversation_id' });
    }

    const messageType = normalizeMessageType(body.type);
    const text =
      typeof body.text === 'string' ? body.text.trim().slice(0, 5000) : '';
    const uri = typeof body.uri === 'string' ? body.uri.trim() : '';
    if (!text && !uri) {
      return res.status(400).json({ error: 'empty_message' });
    }

    const clientNonce =
      typeof body.clientNonce === 'string' ? body.clientNonce.trim() : '';
    if (clientNonce) {
      const existing = await db
        .collection('conversations')
        .doc(conversationId)
        .collection('messages')
        .where('clientNonce', '==', clientNonce)
        .limit(1)
        .get();
      if (!existing.empty) {
        return res.json({
          ok: true,
          messageId: existing.docs[0].id,
          idempotent: true,
        });
      }
    }

    const messageIdRaw =
      typeof body.messageId === 'string' ? body.messageId.trim() : '';
    const messageId = (messageIdRaw || `m_${crypto.randomUUID()}`)
      .replace(/[\\/#?]/g, '_')
      .slice(0, 120);
    const senderName =
      typeof body.senderName === 'string' && body.senderName.trim().length > 0
        ? body.senderName.trim().slice(0, 80)
        : 'Alert User';

    const messagePayload = {
      senderId: identity.userId,
      senderName,
      type: messageType,
      text: text || undefined,
      uri: uri || undefined,
      meta: body.meta && typeof body.meta === 'object' ? body.meta : undefined,
      replyTo:
        body.replyTo && typeof body.replyTo === 'object'
          ? body.replyTo
          : undefined,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      clientNonce: clientNonce || undefined,
      status: 'sent',
    };

    await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .doc(messageId)
      .set(messagePayload, { merge: true });

    const members = Array.isArray(body?.conversation?.members)
      ? body.conversation.members
          .map(item => String(item || '').trim())
          .filter(Boolean)
      : [];
    const isGuardiansConversation =
      conversationId === GUARDIANS_CONVERSATION_ID;
    const conversationUpdate = {
      type: isGuardiansConversation
        ? 'group'
        : normalizeChatType(body?.conversation?.type),
      title:
        typeof body?.conversation?.title === 'string' &&
        body.conversation.title.trim().length > 0
          ? body.conversation.title.trim().slice(0, 120)
          : isGuardiansConversation
          ? 'Guardioes'
          : conversationId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessage: {
        senderId: identity.userId,
        senderName,
        type: messageType,
        text: previewFromMessage({ type: messageType, text }),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    };
    if (isGuardiansConversation) {
      conversationUpdate.metadata = {
        isGuardians: true,
        conversationType: 'GUARDIANS_GROUP',
      };
    }
    if (members.length > 0) {
      conversationUpdate.members = admin.firestore.FieldValue.arrayUnion(
        ...members,
      );
    }

    await db
      .collection('conversations')
      .doc(conversationId)
      .set(conversationUpdate, { merge: true });

    return res.json({
      ok: true,
      messageId,
      acceptedAt: nowIso(),
    });
  } catch (error) {
    console.error('[chat/send]', error);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/chat/ack', async (req, res) => {
  try {
    const identity = resolveIdentity(req);
    const body = req.body || {};
    const conversationId = String(body.conversationId || '').trim();
    const messageId = String(body.messageId || '').trim();
    const status = String(body.status || '').toLowerCase();
    if (!conversationId || !messageId) {
      return res.status(400).json({ error: 'missing_conversation_or_message' });
    }
    if (status !== 'delivered' && status !== 'read') {
      return res.status(400).json({ error: 'invalid_status' });
    }

    const ackUpdate = {
      status: status === 'read' ? 'delivered' : 'sent',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (status === 'delivered') {
      ackUpdate.deliveredBy = admin.firestore.FieldValue.arrayUnion(
        identity.userId,
      );
    }
    if (status === 'read') {
      ackUpdate.readBy = admin.firestore.FieldValue.arrayUnion(identity.userId);
    }

    await db
      .collection('conversations')
      .doc(conversationId)
      .collection('messages')
      .doc(messageId)
      .set(ackUpdate, { merge: true });

    return res.json({
      ok: true,
      conversationId,
      messageId,
      status,
      acknowledgedAt: nowIso(),
    });
  } catch (error) {
    console.error('[chat/ack]', error);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/relay/token', async (req, res) => {
  try {
    const identity = resolveIdentity(req);
    if (!identity.userId || !identity.deviceId) {
      return res.status(400).json({ error: 'missing_identity' });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + Math.max(120, RELAY_TOKEN_TTL_SEC);
    const payload = {
      sub: identity.userId,
      did: identity.deviceId,
      iat: nowSec,
      exp,
      jti: crypto.randomUUID(),
    };

    const token = createRelayToken(payload);
    return res.json({
      token,
      expiresAt: new Date(exp * 1000).toISOString(),
      tokenType: 'Bearer',
    });
  } catch (error) {
    console.error('[relay/token]', error);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/relay/ping', (_req, res) => {
  return res.json({
    ok: true,
    at: nowIso(),
  });
});

app.post('/api/relay/sos', relayAuthMiddleware, async (req, res) => {
  const startedAt = Date.now();
  const userId = req.relay.userId;
  const deviceId = req.relay.deviceId;
  const rateKey = `relay:sos:${userId}:${deviceId}`;
  const requestId = buildRelaySosRequestId(
    req.headers['x-alert-request-id'] ||
      req.headers['x-request-id'] ||
      req.body?.requestId,
  );
  const route = '/api/relay/sos';
  const method = 'POST';
  res.setHeader('X-Alert-Request-Id', requestId);

  logRelaySosEvent(console, 'relay_sos_request_started', {
    requestId,
    route,
    method,
    accepted: false,
    queued: false,
    fallbackUsed: false,
  });

  if (enforceRelayRateLimit(rateKey, 20)) {
    const durationMs = Date.now() - startedAt;
    markRelayMetric('sos', false, durationMs);
    logRelaySosEvent(console, 'relay_sos_request_failed', {
      requestId,
      route,
      method,
      statusCode: 429,
      accepted: false,
      queued: false,
      fallbackUsed: false,
      errorCode: 'rate_limited',
      durationMs,
    });
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const payload = decodeRelayPayload(req.body);
    const metadata = req.body?.metadata || {};
    const integrity =
      payload?.integrity && typeof payload.integrity === 'object'
        ? payload.integrity
        : null;

    if (
      !payload ||
      !payload.location ||
      typeof payload.location.latitude !== 'number' ||
      typeof payload.location.longitude !== 'number'
    ) {
      const durationMs = Date.now() - startedAt;
      markRelayMetric('sos', false, durationMs);
      logRelaySosEvent(console, 'relay_sos_request_failed', {
        requestId,
        route,
        method,
        statusCode: 400,
        accepted: false,
        queued: false,
        fallbackUsed: false,
        errorCode: 'invalid_payload',
        durationMs,
      });
      return res.status(400).json({ error: 'invalid_payload' });
    }

    let integrityRecord = null;
    if (integrity) {
      const alg = String(integrity.alg || '').trim().toLowerCase();
      const version = Number(integrity.version || 0);
      const digest = String(integrity.digest || '').trim().toLowerCase();
      if (alg !== 'sha256' || version !== 1 || !digest) {
        const durationMs = Date.now() - startedAt;
        markRelayMetric('sos', false, durationMs);
        logRelaySosEvent(console, 'relay_sos_request_failed', {
          requestId,
          route,
          method,
          statusCode: 400,
          accepted: false,
          queued: false,
          fallbackUsed: false,
          errorCode: 'invalid_integrity',
          durationMs,
        });
        return res.status(400).json({ error: 'invalid_integrity' });
      }
      const expectedDigest = computeRelaySosIntegrityDigest(payload);
      if (digest !== expectedDigest) {
        const durationMs = Date.now() - startedAt;
        markRelayMetric('sos', false, durationMs);
        logRelaySosEvent(console, 'relay_sos_request_failed', {
          requestId,
          route,
          method,
          statusCode: 400,
          accepted: false,
          queued: false,
          fallbackUsed: false,
          errorCode: 'integrity_mismatch',
          durationMs,
        });
        return res.status(400).json({ error: 'integrity_mismatch' });
      }
      integrityRecord = {
        verified: true,
        alg,
        version,
        digest,
      };
    }

    const docRef = db.collection('relay_sos').doc();
    await docRef.set({
      relayId: docRef.id,
      userId,
      deviceId,
      createdAt: nowIso(),
      payload: {
        id: String(payload.id || ''),
        location: payload.location,
        contactsCount: Array.isArray(payload.contacts)
          ? payload.contacts.length
          : 0,
        userName: String(payload.userName || ''),
        priority: String(payload.priority || 'high'),
        integrity: integrityRecord,
      },
      transport: {
        networkType: String(metadata.networkType || 'unknown'),
        starlinkDetected: Boolean(metadata.starlinkDetected),
        starlinkSsidHash: metadata.starlinkSsidHash
          ? String(metadata.starlinkSsidHash)
          : null,
        profile: String(metadata.transportProfile || 'normal'),
      },
    });

    const durationMs = Date.now() - startedAt;
    markRelayMetric('sos', true, durationMs);
    logRelaySosEvent(console, 'relay_sos_request_accepted', {
      requestId,
      relayId: docRef.id,
      route,
      method,
      statusCode: 200,
      accepted: true,
      queued: false,
      fallbackUsed: false,
      durationMs,
    });

    return res.json({
      ok: true,
      requestId,
      relayId: docRef.id,
      acceptedAt: nowIso(),
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    console.error('[relay/sos]', error);
    markRelayMetric('sos', false, durationMs);
    logRelaySosEvent(console, 'relay_sos_request_failed', {
      requestId,
      route,
      method,
      statusCode: 500,
      accepted: false,
      queued: false,
      fallbackUsed: false,
      errorCode: sanitizeErrorCode(error?.code || error?.message || 'internal'),
      durationMs,
    });
    return res.status(500).json({ error: 'internal' });
  }
});

const relayAlertsPullHandler = async (req, res) => {
  const startedAt = Date.now();
  const userId = req.relay.userId;
  const deviceId = req.relay.deviceId;
  const rateKey = `relay:alerts:${userId}:${deviceId}`;

  if (enforceRelayRateLimit(rateKey, 60)) {
    markRelayMetric('alertsPull', false, Date.now() - startedAt);
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const payload =
      req.method === 'GET'
        ? {
            cursor: req.query?.cursor,
            limit: req.query?.limit,
          }
        : decodeRelayPayload(req.body) || {};
    const limit = sanitizeLimit(payload.limit, 20, 50);
    const cursor = payload.cursor ? String(payload.cursor) : null;

    let query = db
      .collection('sos_alerts')
      .where('toId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(limit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const nextCursor =
      items.length > 0 ? String(items[items.length - 1].createdAt || '') : null;

    markRelayMetric('alertsPull', true, Date.now() - startedAt);

    return res.json({
      ok: true,
      items,
      nextCursor,
      pulledAt: nowIso(),
    });
  } catch (error) {
    console.error('[relay/alerts/pull]', error);
    markRelayMetric('alertsPull', false, Date.now() - startedAt);
    return res.status(500).json({ error: 'internal' });
  }
};

app.post('/api/relay/alerts/pull', relayAuthMiddleware, relayAlertsPullHandler);
app.get('/api/relay/alerts/pull', relayAuthMiddleware, relayAlertsPullHandler);

app.post('/api/relay/chat/send', relayAuthMiddleware, async (req, res) => {
  const startedAt = Date.now();
  const userId = req.relay.userId;
  const deviceId = req.relay.deviceId;
  const rateKey = `relay:chat:${userId}:${deviceId}`;

  if (enforceRelayRateLimit(rateKey, 90)) {
    markRelayMetric('chatSend', false, Date.now() - startedAt);
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const payload = decodeRelayPayload(req.body);
    if (!payload || !payload.conversationId || !payload.text) {
      markRelayMetric('chatSend', false, Date.now() - startedAt);
      return res.status(400).json({ error: 'invalid_payload' });
    }

    const docRef = db.collection('relay_chat').doc();
    await docRef.set({
      messageId: docRef.id,
      userId,
      deviceId,
      conversationId: String(payload.conversationId),
      type: String(payload.type || 'text'),
      text: String(payload.text).slice(0, 5000),
      createdAt: payload.createdAt || nowIso(),
      receivedAt: nowIso(),
    });

    markRelayMetric('chatSend', true, Date.now() - startedAt);

    return res.json({
      ok: true,
      messageId: docRef.id,
      acceptedAt: nowIso(),
    });
  } catch (error) {
    console.error('[relay/chat/send]', error);
    markRelayMetric('chatSend', false, Date.now() - startedAt);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/relay/chat/messages', relayAuthMiddleware, async (req, res) => {
  const startedAt = Date.now();
  const userId = req.relay.userId;
  const deviceId = req.relay.deviceId;
  const rateKey = `relay:chat:pull:${userId}:${deviceId}`;

  if (enforceRelayRateLimit(rateKey, 90)) {
    markRelayMetric('chatMessages', false, Date.now() - startedAt);
    return res.status(429).json({ error: 'rate_limited' });
  }

  try {
    const limit = sanitizeLimit(req.query.limit, 40, 120);
    const cursor = req.query.cursor ? String(req.query.cursor) : null;

    let query = db
      .collection('relay_chat')
      .where('userId', '==', userId)
      .orderBy('receivedAt', 'desc')
      .limit(limit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snapshot = await query.get();
    const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const nextCursor =
      items.length > 0
        ? String(items[items.length - 1].receivedAt || '')
        : null;

    markRelayMetric('chatMessages', true, Date.now() - startedAt);
    return res.json({
      ok: true,
      items,
      nextCursor,
      pulledAt: nowIso(),
    });
  } catch (error) {
    console.error('[relay/chat/messages]', error);
    markRelayMetric('chatMessages', false, Date.now() - startedAt);
    return res.status(500).json({ error: 'internal' });
  }
});

app.get('/api/relay/metrics', (_req, res) => {
  const normalize = item => ({
    ...item,
    deliveryRate:
      item.total > 0 ? Number((item.success / item.total).toFixed(4)) : 0,
    avgLatencyMs:
      item.total > 0 ? Math.round(item.totalLatencyMs / item.total) : null,
  });

  return res.json({
    sos: normalize(relayMetrics.sos),
    alertsPull: normalize(relayMetrics.alertsPull),
    chatSend: normalize(relayMetrics.chatSend),
    chatMessages: normalize(relayMetrics.chatMessages),
    generatedAt: nowIso(),
  });
});

app.get('/v1/ops/summary', (_req, res) => {
  const normalize = item => ({
    ...item,
    deliveryRate:
      item.total > 0 ? Number((item.success / item.total).toFixed(4)) : 0,
    avgLatencyMs:
      item.total > 0 ? Math.round(item.totalLatencyMs / item.total) : null,
  });

  return res.json({
    ok: true,
    generatedAt: nowIso(),
    backend: {
      firebaseAvailable: serviceAvailability.firebase,
      degraded: !serviceAvailability.firebase,
      modules: {
        stripeBilling: serviceAvailability.stripeBilling,
        appleBilling: serviceAvailability.appleBilling,
        appStoreNotifications: serviceAvailability.appStoreNotifications,
        sosFanoutQueue: serviceAvailability.sosFanoutQueue,
        sosFanoutQueueDriver: serviceAvailability.sosFanoutQueueDriver,
        sosFanoutQueueReason: serviceAvailability.sosFanoutQueueReason,
      },
    },
    relay: {
      sos: normalize(relayMetrics.sos),
      alertsPull: normalize(relayMetrics.alertsPull),
      chatSend: normalize(relayMetrics.chatSend),
      chatMessages: normalize(relayMetrics.chatMessages),
    },
    providers: getProviderFetchMetrics(),
  });
});

app.post('/api/guardian/request', async (req, res) => {
  try {
    const { fromId, fromName, fromPhone, toId, toPhone } = req.body || {};
    if (!fromId || (!toId && !toPhone)) {
      return res.status(400).json({ error: 'Missing ids' });
    }
    let resolvedTargetId = toId;
    if (!resolvedTargetId && toPhone) {
      const query = await db
        .collection('users')
        .where('phone', '==', toPhone)
        .limit(1)
        .get();
      if (query.empty) {
        return res.status(404).json({ error: 'not_found' });
      }
      resolvedTargetId = query.docs[0].id;
    }
    if (!resolvedTargetId) {
      return res.status(404).json({ error: 'not_found' });
    }
    const requestRef = db.collection('guardian_requests').doc();
    const payload = {
      fromId,
      fromName: fromName || 'Usuario Alert',
      fromPhone: fromPhone || null,
      toId: resolvedTargetId,
      status: 'pending',
      createdAt: nowIso(),
    };
    await requestRef.set(payload);

    const target = await db.collection('users').doc(resolvedTargetId).get();
    const token = target.data()?.fcmToken;
    if (token) {
      await admin.messaging().send({
        token,
        data: {
          type: 'guardian_request',
          requesterName: payload.fromName,
          requesterPhone: payload.fromPhone || '',
          requesterId: payload.fromId,
          requestId: requestRef.id,
        },
        notification: {
          title: 'Convite para guardiao',
          body: `${payload.fromName} quer adicionar voce como guardiao.`,
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
      });
    }

    return res.json({
      ok: true,
      requestId: requestRef.id,
      targetId: resolvedTargetId,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/sos', async (req, res) => {
  try {
    const { fromId, fromName, message, location, targets } = req.body || {};
    if (!fromId || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'Missing targets' });
    }
    const now = nowIso();
    const batch = db.batch();
    targets.forEach(targetId => {
      const ref = db.collection('sos_alerts').doc();
      batch.set(ref, {
        fromId,
        fromName: fromName || 'Usuario Alert',
        toId: targetId,
        location: location || null,
        message: message || '',
        createdAt: now,
        status: 'new',
      });
    });
    await batch.commit();

    const tokens = [];
    for (const targetId of targets) {
      const doc = await db.collection('users').doc(targetId).get();
      const token = doc.data()?.fcmToken;
      if (token) tokens.push(token);
    }
    let fanoutResult = {
      mode: 'none',
      queued: false,
      sentInline: false,
      tokenCount: 0,
    };
    if (tokens.length > 0) {
      fanoutResult = await sosFanoutDispatcher.dispatch({
        fromId,
        fromName: fromName || 'Guardiao',
        message: message || '',
        location: location || null,
        targets,
        tokens,
        timestamp: now,
      });
    }

    return res.json({
      ok: true,
      fanout: {
        mode: fanoutResult.mode,
        queued: fanoutResult.queued,
        deduped: Boolean(fanoutResult.deduped),
        sentInline: fanoutResult.sentInline,
        jobId: fanoutResult.jobId || null,
        tokenCount: fanoutResult.tokenCount,
      },
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal' });
  }
});

app.post('/api/checkin', async (req, res) => {
  try {
    const { fromId, fromName, message, city, targets } = req.body || {};
    if (!fromId || !Array.isArray(targets) || targets.length === 0) {
      return res.status(400).json({ error: 'Missing targets' });
    }
    const now = nowIso();
    const safeMessage = typeof message === 'string' ? message : 'Estou saindo';
    const safeCity = typeof city === 'string' ? city : '';

    const batch = db.batch();
    targets.forEach(targetId => {
      const ref = db.collection('checkins').doc();
      batch.set(ref, {
        fromId,
        fromName: fromName || 'Usuario Alert',
        toId: targetId,
        city: safeCity || null,
        message: safeMessage,
        createdAt: now,
        status: 'new',
      });
    });
    await batch.commit();

    const tokens = [];
    for (const targetId of targets) {
      const doc = await db.collection('users').doc(targetId).get();
      const token = doc.data()?.fcmToken;
      if (token) tokens.push(token);
    }

    if (tokens.length > 0) {
      const sender = fromName || 'Alguem';
      const body = safeCity
        ? `${sender} esta saindo • ${safeCity}`
        : `${sender} esta saindo`;
      await admin.messaging().sendEachForMulticast({
        tokens,
        data: {
          type: 'checkin',
          senderName: sender,
          message: safeMessage,
          city: safeCity || '',
          timestamp: now,
        },
        notification: {
          title: 'Check-in',
          body,
        },
        android: {
          notification: {
            channelId: 'alert_daily_channel',
          },
        },
        apns: {
          payload: {
            aps: { sound: 'default' },
          },
        },
      });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'internal' });
  }
});

const parseFiniteQueryNumber = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const mapProviderTrustBadge = providers => {
  const rows = Array.isArray(providers) ? providers : [];
  if (rows.length === 0) return 'limited';

  const hasOfficial = rows.some(
    provider =>
      provider?.ok === true && String(provider?.trustTier || '') === 'A',
  );
  if (hasOfficial) return 'official';
  const hasVerified = rows.some(
    provider =>
      provider?.ok === true && String(provider?.trustTier || '') === 'B',
  );
  if (hasVerified) return 'verified';
  const hasReference = rows.some(
    provider =>
      provider?.ok === true && String(provider?.trustTier || '') === 'C',
  );
  if (hasReference) return 'reference';
  return 'limited';
};

const OPERATIONAL_SOURCE_CLASSES = [
  'official',
  'official_social',
  'major_media',
  'verified_partner',
  'internal_alert',
  'community',
  'reference',
];

const MONITORED_SITUATION_TYPES = [
  'energy_outage',
  'water_outage',
  'earthquake',
  'flood',
  'heat',
  'wind',
  'storm',
  'lightning',
  'cyclone',
  'tornado',
  'hurricane',
  'landslide',
  'pandemic',
  'epidemic',
  'snowstorm',
  'avalanche',
  'wildfire',
  'hail',
  'heatwave',
  'tsunami',
  'meteor',
  'fog',
  'drought',
  'gale',
  'volcano',
  'high_tide',
  'sandstorm',
  'downdraft',
  'volcanic_cloud',
  'rogue_waves',
  'wind_gust_50',
  'wind_gust_10',
  'dust_devils',
  'sos',
];
const MONITORED_SITUATION_SET = new Set(MONITORED_SITUATION_TYPES);
const OPERATIONAL_DANGER_WEIGHT_BY_TYPE = {
  energy_outage: 0.44,
  water_outage: 0.42,
  earthquake: 0.96,
  flood: 0.9,
  heat: 0.56,
  wind: 0.4,
  storm: 0.8,
  lightning: 0.76,
  cyclone: 0.94,
  tornado: 1,
  hurricane: 0.98,
  landslide: 0.94,
  pandemic: 0.66,
  epidemic: 0.62,
  snowstorm: 0.72,
  avalanche: 0.98,
  wildfire: 0.96,
  hail: 0.46,
  heatwave: 0.68,
  tsunami: 1,
  meteor: 0.88,
  fog: 0.34,
  drought: 0.5,
  gale: 0.58,
  volcano: 0.98,
  high_tide: 0.46,
  sandstorm: 0.64,
  downdraft: 0.78,
  volcanic_cloud: 0.74,
  rogue_waves: 0.92,
  wind_gust_50: 0.72,
  wind_gust_10: 0.26,
  dust_devils: 0.28,
  sos: 0.86,
};

const normalizeOperationalSourceClass = value => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return OPERATIONAL_SOURCE_CLASSES.includes(normalized)
    ? normalized
    : 'reference';
};

const sourceClassWeight = sourceClass => {
  if (sourceClass === 'official') return 1;
  if (sourceClass === 'official_social') return 0.94;
  if (sourceClass === 'internal_alert') return 0.9;
  if (sourceClass === 'major_media') return 0.84;
  if (sourceClass === 'verified_partner') return 0.8;
  if (sourceClass === 'community') return 0.68;
  return 0.58;
};

const trustTierWeight = trustTier => {
  const normalized = String(trustTier || '')
    .trim()
    .toUpperCase();
  if (normalized === 'A') return 1;
  if (normalized === 'B') return 0.88;
  return 0.72;
};

const sourceAuthorityWeight = source => {
  const sourceClass = normalizeOperationalSourceClass(source?.sourceClass);
  const explicitAuthority = clampUnit(source?.sourceAuthority);
  const classWeight = sourceClassWeight(sourceClass);
  const authority = explicitAuthority > 0 ? explicitAuthority : classWeight;
  const tierWeight = trustTierWeight(source?.trustTier);
  return clampUnit(authority * 0.72 + tierWeight * 0.28);
};

const freshnessWeightFromMillis = updatedAtMs => {
  if (!Number.isFinite(updatedAtMs) || updatedAtMs <= 0) return 0.52;
  const ageMin = Math.max(0, (Date.now() - updatedAtMs) / 60_000);
  if (ageMin <= 10) return 1;
  if (ageMin <= 30) return 0.94;
  if (ageMin <= 120) return 0.84;
  if (ageMin <= 360) return 0.72;
  return 0.58;
};

const capLevelToScoreLevel = capLevel => {
  if (capLevel >= 4) return 92;
  if (capLevel >= 3) return 78;
  if (capLevel >= 2) return 58;
  if (capLevel >= 1) return 34;
  return 18;
};

const capLevelToSituationPressure = capLevel => {
  if (capLevel >= 4) return 1;
  if (capLevel >= 3) return 0.82;
  if (capLevel >= 2) return 0.6;
  if (capLevel >= 1) return 0.34;
  return 0.16;
};

const summarizeSourceEvidence = events => {
  const summary = {
    official: 0,
    official_social: 0,
    major_media: 0,
    verified_partner: 0,
    internal_alert: 0,
    community: 0,
    reference: 0,
  };
  const namesByClass = new Map();

  for (const event of events) {
    const sourceClass = normalizeOperationalSourceClass(
      event?.source?.sourceClass,
    );
    const sourceName =
      String(event?.source?.name || sourceClass).trim() || sourceClass;
    const key = `${sourceClass}:${sourceName.toLowerCase()}`;
    namesByClass.set(key, sourceClass);
  }

  for (const sourceClass of namesByClass.values()) {
    summary[sourceClass] += 1;
  }

  const dominantSourceClass =
    Object.entries(summary)
      .filter(([, count]) => count > 0)
      .sort(
        (a, b) =>
          b[1] - a[1] || sourceClassWeight(b[0]) - sourceClassWeight(a[0]),
      )[0]?.[0] || 'reference';

  return {
    summary,
    dominantSourceClass,
    distinctSourceCount: namesByClass.size,
  };
};

const normalizeSituationType = value => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return MONITORED_SITUATION_SET.has(normalized) ? normalized : '';
};

const dangerWeightForSituationType = type => {
  const normalizedType = normalizeSituationType(type);
  if (!normalizedType) return 0.48;
  return Number(OPERATIONAL_DANGER_WEIGHT_BY_TYPE[normalizedType] || 0.48);
};

const pointFromEvent = event => {
  const lon = Number(event?.geometry?.coordinates?.[0]);
  const lat = Number(event?.geometry?.coordinates?.[1]);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    return { latitude: lat, longitude: lon };
  }

  const bbox = event?.bbox;
  if (
    bbox &&
    Number.isFinite(Number(bbox.minLat)) &&
    Number.isFinite(Number(bbox.minLon)) &&
    Number.isFinite(Number(bbox.maxLat)) &&
    Number.isFinite(Number(bbox.maxLon))
  ) {
    return {
      latitude: (Number(bbox.minLat) + Number(bbox.maxLat)) / 2,
      longitude: (Number(bbox.minLon) + Number(bbox.maxLon)) / 2,
    };
  }

  return null;
};

const distanceKmFromPointToEvent = (userLocation, event) => {
  if (
    !userLocation ||
    !Number.isFinite(Number(userLocation.latitude)) ||
    !Number.isFinite(Number(userLocation.longitude))
  ) {
    return null;
  }

  const bbox = event?.bbox;
  if (
    bbox &&
    Number.isFinite(Number(bbox.minLat)) &&
    Number.isFinite(Number(bbox.minLon)) &&
    Number.isFinite(Number(bbox.maxLat)) &&
    Number.isFinite(Number(bbox.maxLon))
  ) {
    const insideLat =
      userLocation.latitude >= Number(bbox.minLat) &&
      userLocation.latitude <= Number(bbox.maxLat);
    const insideLon =
      userLocation.longitude >= Number(bbox.minLon) &&
      userLocation.longitude <= Number(bbox.maxLon);
    if (insideLat && insideLon) {
      return 0;
    }

    const closestPoint = {
      latitude: Math.max(
        Number(bbox.minLat),
        Math.min(Number(bbox.maxLat), userLocation.latitude),
      ),
      longitude: Math.max(
        Number(bbox.minLon),
        Math.min(Number(bbox.maxLon), userLocation.longitude),
      ),
    };
    return haversineKm(userLocation, closestPoint);
  }

  const eventPoint = pointFromEvent(event);
  if (!eventPoint) return null;
  return haversineKm(userLocation, eventPoint);
};

const proximityWeightFromDistance = (distanceKm, radiusKm) => {
  if (!Number.isFinite(distanceKm) || distanceKm === null) return 0.42;
  const safeRadius = Math.max(5, Math.min(120, Number(radiusKm || 35)));
  if (distanceKm <= 0.5) return 1;
  if (distanceKm <= 2) return 0.96;
  if (distanceKm <= 5) return 0.88;
  if (distanceKm <= 10) return 0.76;
  if (distanceKm <= 20) return 0.58;
  if (distanceKm <= safeRadius) return 0.34;
  return 0.16;
};

const buildEventExposureEvidence = (event, exposureContext) => {
  const eventType = normalizeSituationType(event?.type);
  const capLevel = riskLevelFromCap(
    event?.severity,
    event?.urgency,
    event?.certainty,
  );
  const basePressure = capLevelToSituationPressure(capLevel);
  const baseScore = capLevelToScoreLevel(capLevel);
  const confidenceWeight = clampUnit(event?.confidence || 0.5);
  const authorityWeight = sourceAuthorityWeight(event?.source);
  const freshnessWeight = freshnessWeightFromMillis(
    toEventMillis(event?.updatedAt || event?.startTime),
  );
  const dangerWeight = dangerWeightForSituationType(eventType);
  const distanceKm = distanceKmFromPointToEvent(
    exposureContext?.userLocation,
    event,
  );
  const proximityWeight = exposureContext?.userLocation
    ? proximityWeightFromDistance(distanceKm, exposureContext?.radiusKm)
    : 0.74;
  const signalWeight =
    freshnessWeight * (0.62 + confidenceWeight * 0.2 + authorityWeight * 0.18);
  const exposureWeight = clampUnit(
    (0.18 + proximityWeight * 0.82) * (0.5 + dangerWeight * 0.5),
  );
  const exposurePressure = clampUnit(
    basePressure * signalWeight * exposureWeight,
  );
  const scoreContribution = Math.max(
    0,
    Math.min(100, Math.round(baseScore * signalWeight * exposureWeight)),
  );
  return {
    event,
    eventType,
    capLevel,
    basePressure,
    baseScore,
    confidenceWeight,
    authorityWeight,
    freshnessWeight,
    dangerWeight,
    distanceKm,
    proximityWeight,
    exposureWeight,
    exposurePressure,
    scoreContribution,
    isExposed: exposurePressure >= 0.22 || proximityWeight >= 0.76,
  };
};

const eventSituationPressure = event => {
  const capLevel = riskLevelFromCap(
    event?.severity,
    event?.urgency,
    event?.certainty,
  );
  const basePressure = capLevelToSituationPressure(capLevel);
  const confidenceWeight = clampUnit(event?.confidence || 0.5);
  const authorityWeight = sourceAuthorityWeight(event?.source);
  const freshnessWeight = freshnessWeightFromMillis(
    toEventMillis(event?.updatedAt || event?.startTime),
  );
  return clampUnit(
    basePressure *
      (0.78 + confidenceWeight * 0.14 + authorityWeight * 0.08) *
      freshnessWeight,
  );
};

const summarizeSituationEvidence = (events, exposureContext) => {
  const pressureByType = new Map();
  const exposureByType = new Map();
  const distances = [];

  for (const event of Array.isArray(events) ? events : []) {
    const eventType = normalizeSituationType(event?.type);
    if (!eventType) continue;
    const pressure = eventSituationPressure(event);
    const current = pressureByType.get(eventType) || 0;
    if (pressure > current) {
      pressureByType.set(eventType, pressure);
    }

    const exposureEvidence = buildEventExposureEvidence(event, exposureContext);
    const currentExposure = exposureByType.get(eventType) || 0;
    if (exposureEvidence.exposurePressure > currentExposure) {
      exposureByType.set(eventType, exposureEvidence.exposurePressure);
    }
    if (Number.isFinite(exposureEvidence.distanceKm)) {
      distances.push(Number(exposureEvidence.distanceKm));
    }
  }

  const values = Array.from(pressureByType.values());
  const exposureValues = Array.from(exposureByType.values());
  const monitoredSituationCount = MONITORED_SITUATION_TYPES.length;
  const activeSituationCount = pressureByType.size;
  const exposedSituationCount = exposureValues.filter(
    value => value >= 0.22,
  ).length;
  const activeSituationRatio =
    monitoredSituationCount > 0
      ? clampUnit(activeSituationCount / monitoredSituationCount)
      : 0;
  const exposedSituationRatio =
    monitoredSituationCount > 0
      ? clampUnit(exposedSituationCount / monitoredSituationCount)
      : 0;
  const situationPressure =
    monitoredSituationCount > 0
      ? clampUnit(
          values.reduce((sum, value) => sum + value, 0) /
            monitoredSituationCount,
        )
      : 0;
  const exposurePressure =
    monitoredSituationCount > 0
      ? clampUnit(
          exposureValues.reduce((sum, value) => sum + value, 0) /
            monitoredSituationCount,
        )
      : 0;
  const topSituationPressure = values.length > 0 ? Math.max(...values) : 0;
  const topExposurePressure =
    exposureValues.length > 0 ? Math.max(...exposureValues) : 0;
  const highSituationCount = values.filter(value => value >= 0.78).length;
  const mediumSituationCount = values.filter(
    value => value >= 0.5 && value < 0.78,
  ).length;
  const criticalExposureCount = exposureValues.filter(
    value => value >= 0.72,
  ).length;
  const nearestThreatKm =
    distances.length > 0 ? Math.round(Math.min(...distances) * 10) / 10 : null;

  return {
    monitoredSituationCount,
    activeSituationCount,
    activeSituationRatio,
    exposedSituationCount,
    exposedSituationRatio,
    highSituationCount,
    mediumSituationCount,
    situationPressure,
    exposurePressure,
    topSituationPressure,
    topExposurePressure,
    criticalExposureCount,
    nearestThreatKm,
  };
};

const WEATHER_NOWCAST_PROVIDER_NAMES = ['Open-Meteo Nowcast'];
const WEATHER_NOWCAST_TYPES = new Set([
  'storm',
  'lightning',
  'hail',
  'snowstorm',
  'flood',
]);

const isFreshLocalNowcastRow = row => {
  const providerName = String(row?.event?.source?.name || '').trim();
  const eventType = normalizeSituationType(row?.event?.type);
  if (!WEATHER_NOWCAST_TYPES.has(eventType)) return false;
  if (!WEATHER_NOWCAST_PROVIDER_NAMES.includes(providerName)) return false;
  return (
    Number(row?.freshnessWeight || 0) >= 0.94 &&
    Number(row?.proximityWeight || 0) >= 0.76
  );
};

const computeScoreLevelFromEvidence = ({
  exposureRows,
  freshnessSec,
  providers,
  sourceEvidence,
  situationEvidence,
}) => {
  const scopedRows = Array.isArray(exposureRows)
    ? exposureRows.filter(row =>
        Boolean(normalizeSituationType(row?.event?.type)),
      )
    : [];
  const relevantRows = scopedRows.filter(row => row.isExposed);

  if (scopedRows.length === 0) {
    const okProviders = (Array.isArray(providers) ? providers : []).filter(
      provider => provider?.ok === true,
    );
    const avgAuthority =
      okProviders.length > 0
        ? okProviders.reduce(
            (sum, provider) => sum + sourceAuthorityWeight(provider),
            0,
          ) / okProviders.length
        : 0.4;
    const stalePenalty =
      freshnessSec > 30 * 60 ? 8 : freshnessSec > 10 * 60 ? 4 : 0;
    return Math.max(8, Math.round(14 + avgAuthority * 16 - stalePenalty));
  }

  const scoreRows = relevantRows.length > 0 ? relevantRows : scopedRows;
  const topExposureScore = scoreRows.reduce((maxScore, row) => {
    return Math.max(maxScore, Number(row.scoreContribution || 0));
  }, 0);

  const exposurePressureScore = Math.round(
    (situationEvidence?.exposurePressure || 0) * 32,
  );
  const exposureCoverageBonus = Math.min(
    8,
    Math.round(Number(situationEvidence?.exposedSituationCount || 0) * 1.6),
  );
  const criticalExposureBonus = Math.min(
    16,
    Number(situationEvidence?.criticalExposureCount || 0) * 5,
  );
  const corroborationBonus = Math.min(
    12,
    Math.max(0, sourceEvidence.distinctSourceCount - 1) * 3,
  );
  const nowcastRows = scoreRows.filter(isFreshLocalNowcastRow);
  const nowcastBonus = Math.min(
    12,
    nowcastRows.reduce((sum, row) => {
      const type = normalizeSituationType(row?.event?.type);
      if (type === 'lightning' || type === 'flood') return sum + 5;
      if (type === 'storm' || type === 'hail' || type === 'snowstorm')
        return sum + 4;
      return sum + 3;
    }, 0),
  );
  const officialBonus =
    sourceEvidence.summary.official > 0
      ? 4
      : sourceEvidence.summary.official_social > 0
      ? 3
      : sourceEvidence.summary.major_media > 0
      ? 2
      : sourceEvidence.summary.internal_alert > 0
      ? 2
      : 0;
  const stalePenalty =
    freshnessSec > 3 * 60 * 60
      ? 10
      : freshnessSec > 60 * 60
      ? 6
      : freshnessSec > 20 * 60
      ? 3
      : 0;
  return Math.max(
    0,
    Math.min(
      100,
      Math.round(
        topExposureScore * 0.72 +
          exposurePressureScore +
          exposureCoverageBonus +
          criticalExposureBonus +
          corroborationBonus +
          nowcastBonus +
          officialBonus -
          stalePenalty,
      ),
    ),
  );
};

const uniqueReasonCodes = reasonCodes =>
  Array.from(
    new Set(
      (Array.isArray(reasonCodes) ? reasonCodes : []).filter(
        code => typeof code === 'string' && code.trim(),
      ),
    ),
  );

const deriveScoreDriver = ({
  correctedScoreLevel,
  reasonCodes,
  situationEvidence,
  sourceEvidence,
}) => {
  const nearestThreatKm = Number(situationEvidence?.nearestThreatKm);
  if (reasonCodes.includes('critical_close_exposure'))
    return 'critical_close_exposure';
  if (reasonCodes.includes('critical_exposure')) return 'critical_exposure';
  if (reasonCodes.includes('multiple_exposures')) return 'multiple_exposures';
  if (reasonCodes.includes('corroborated_official_signal'))
    return 'corroborated_official_signal';
  if (reasonCodes.includes('weak_source_uncorroborated'))
    return 'weak_source_uncorroborated';
  if (reasonCodes.includes('stale_signal_penalty')) return 'low_evidence_stale';
  if (Number.isFinite(nearestThreatKm) && nearestThreatKm <= 2)
    return 'nearby_exposure';
  if (Number(situationEvidence?.highSituationCount || 0) > 0)
    return 'high_severity_cluster';
  if (
    Number(sourceEvidence?.summary?.official || 0) > 0 ||
    Number(sourceEvidence?.summary?.official_social || 0) > 0
  ) {
    return 'corroborated_official_signal';
  }
  if (correctedScoreLevel <= 34) return 'low_exposure_baseline';
  return 'baseline';
};

const verifyOperationalScoreLevel = ({
  rawScoreLevel,
  confidence,
  freshnessSec,
  sourceEvidence,
  situationEvidence,
}) => {
  const reasons = [];
  let minScore = 0;
  let maxScore = 100;

  const distinctSourceCount = Math.max(
    0,
    Number(sourceEvidence?.distinctSourceCount || 0),
  );
  const officialCount = Math.max(
    0,
    Number(sourceEvidence?.summary?.official || 0),
  );
  const officialSocialCount = Math.max(
    0,
    Number(sourceEvidence?.summary?.official_social || 0),
  );
  const verifiedPartnerCount = Math.max(
    0,
    Number(sourceEvidence?.summary?.verified_partner || 0),
  );
  const majorMediaCount = Math.max(
    0,
    Number(sourceEvidence?.summary?.major_media || 0),
  );
  const internalAlertCount = Math.max(
    0,
    Number(sourceEvidence?.summary?.internal_alert || 0),
  );
  const trustedSourceCount =
    officialCount +
    officialSocialCount +
    verifiedPartnerCount +
    majorMediaCount +
    internalAlertCount;
  const onlyWeakSources = distinctSourceCount <= 1 && trustedSourceCount === 0;

  const exposedSituationCount = Math.max(
    0,
    Number(situationEvidence?.exposedSituationCount || 0),
  );
  const activeSituationCount = Math.max(
    0,
    Number(situationEvidence?.activeSituationCount || 0),
  );
  const criticalExposureCount = Math.max(
    0,
    Number(situationEvidence?.criticalExposureCount || 0),
  );
  const highSituationCount = Math.max(
    0,
    Number(situationEvidence?.highSituationCount || 0),
  );
  const topExposurePressure = clampUnit(
    situationEvidence?.topExposurePressure || 0,
  );
  const exposurePressure = clampUnit(situationEvidence?.exposurePressure || 0);
  const topSituationPressure = clampUnit(
    situationEvidence?.topSituationPressure || 0,
  );
  const nearestThreatKm = Number(situationEvidence?.nearestThreatKm);
  const hasNearestThreat = Number.isFinite(nearestThreatKm);

  if (criticalExposureCount > 0 && hasNearestThreat && nearestThreatKm <= 1.2) {
    minScore = Math.max(minScore, 84);
    reasons.push('critical_close_exposure');
  } else if (criticalExposureCount > 0) {
    minScore = Math.max(minScore, 76);
    reasons.push('critical_exposure');
  } else if (exposedSituationCount >= 3 && exposurePressure >= 0.42) {
    minScore = Math.max(minScore, 68);
    reasons.push('multiple_exposures');
  } else if (
    exposedSituationCount >= 1 &&
    topExposurePressure >= 0.42 &&
    hasNearestThreat &&
    nearestThreatKm <= 2
  ) {
    minScore = Math.max(minScore, 52);
    reasons.push('nearby_exposure');
  }

  if (highSituationCount >= 2 && confidence >= 0.65) {
    minScore = Math.max(minScore, 70);
    reasons.push('high_severity_cluster');
  }

  if (
    trustedSourceCount >= 2 &&
    confidence >= 0.72 &&
    topExposurePressure >= 0.48
  ) {
    minScore = Math.max(minScore, 62);
    reasons.push('corroborated_official_signal');
  }

  if (
    exposedSituationCount === 0 &&
    activeSituationCount === 0 &&
    freshnessSec <= 20 * 60
  ) {
    maxScore = Math.min(maxScore, 26);
    reasons.push('no_active_exposure');
  } else if (
    exposedSituationCount === 0 &&
    topSituationPressure < 0.34 &&
    freshnessSec <= 20 * 60
  ) {
    maxScore = Math.min(maxScore, 34);
    reasons.push('no_confirmed_exposure');
  }

  if (onlyWeakSources && rawScoreLevel >= 42 && confidence < 0.58) {
    maxScore = Math.min(maxScore, 41);
    reasons.push('weak_source_uncorroborated');
  }

  if (freshnessSec > 3 * 60 * 60) {
    maxScore = Math.min(maxScore, Math.max(minScore, 54));
    reasons.push('stale_signal_penalty');
  } else if (
    freshnessSec > 60 * 60 &&
    rawScoreLevel >= 70 &&
    distinctSourceCount < 2
  ) {
    maxScore = Math.min(maxScore, Math.max(minScore, 68));
    reasons.push('aging_signal_penalty');
  }

  const correctedScoreLevel = clampPercent(
    Math.max(
      minScore,
      Math.min(maxScore, Math.round(Number(rawScoreLevel || 0))),
    ),
  );
  const reasonCodes = uniqueReasonCodes(reasons);

  return {
    status:
      correctedScoreLevel === Math.round(Number(rawScoreLevel || 0))
        ? 'verified'
        : 'corrected',
    rawScoreLevel: clampPercent(rawScoreLevel),
    correctedScoreLevel,
    reasonCodes,
    dominantDriver: deriveScoreDriver({
      correctedScoreLevel,
      reasonCodes,
      situationEvidence,
      sourceEvidence,
    }),
    lowerBound: minScore,
    upperBound: maxScore,
  };
};

const computeOperationalSnapshot = (payload, exposureContext) => {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const providers = Array.isArray(payload?.providers) ? payload.providers : [];
  const nowMs = Date.now();
  const exposureRows = events
    .filter(event => Boolean(normalizeSituationType(event?.type)))
    .map(event => buildEventExposureEvidence(event, exposureContext));
  const relevantExposureRows = exposureRows.filter(row => row.isExposed);
  const sourceScopedEvents =
    relevantExposureRows.length > 0
      ? relevantExposureRows.map(row => row.event)
      : exposureRows.map(row => row.event);
  const sourceEvidence = summarizeSourceEvidence(sourceScopedEvents);
  const situationEvidence = summarizeSituationEvidence(events, exposureContext);
  const sourceCount = sourceEvidence.distinctSourceCount;

  const latestUpdatedAtMs = events
    .map(event => toEventMillis(event?.updatedAt || event?.startTime))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => b - a)[0];
  const freshnessSec = latestUpdatedAtMs
    ? Math.max(0, Math.round((nowMs - latestUpdatedAtMs) / 1000))
    : 999;

  const confidenceRows =
    relevantExposureRows.length > 0 ? relevantExposureRows : exposureRows;
  const weightedConfidenceRows = confidenceRows
    .map(row => {
      return (
        Number(row.confidenceWeight || 0) *
        Number(row.authorityWeight || 0) *
        (0.58 + Number(row.proximityWeight || 0) * 0.42)
      );
    })
    .filter(value => Number.isFinite(value));
  const confidence =
    weightedConfidenceRows.length > 0
      ? clampUnit(
          weightedConfidenceRows.reduce((sum, value) => sum + value, 0) /
            weightedConfidenceRows.length +
            Math.min(0.18, Math.max(0, sourceCount - 1) * 0.04),
        )
      : providers.some(provider => provider?.ok)
      ? 0.55
      : 0.35;

  const rawScoreLevel = computeScoreLevelFromEvidence({
    exposureRows,
    freshnessSec,
    providers,
    sourceEvidence,
    situationEvidence,
  });
  const scoreVerification = verifyOperationalScoreLevel({
    rawScoreLevel,
    confidence,
    freshnessSec,
    sourceEvidence,
    situationEvidence,
  });
  const scoreLevel = scoreVerification.correctedScoreLevel;
  const riskLevel =
    scoreLevel >= 70 ? 'high' : scoreLevel >= 42 ? 'medium' : 'low';

  const providerTtlMs = providers
    .map(provider => Number(provider?.cacheTTLms || 0))
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)[0];
  const ttlMs = Math.max(30_000, Math.min(180_000, providerTtlMs || 60_000));
  const updatedAt = latestUpdatedAtMs
    ? new Date(latestUpdatedAtMs).toISOString()
    : nowIso();

  return {
    riskLevel,
    scoreLevel,
    scoreVerification,
    confidence,
    freshnessSec,
    trustBadge: mapProviderTrustBadge(providers),
    sourceCount,
    dominantSourceClass: sourceEvidence.dominantSourceClass,
    sourceSummary: sourceEvidence.summary,
    monitoredSituationCount: situationEvidence.monitoredSituationCount,
    activeSituationCount: situationEvidence.activeSituationCount,
    activeSituationRatio: situationEvidence.activeSituationRatio,
    exposedSituationCount: situationEvidence.exposedSituationCount,
    exposedSituationRatio: situationEvidence.exposedSituationRatio,
    highSituationCount: situationEvidence.highSituationCount,
    mediumSituationCount: situationEvidence.mediumSituationCount,
    situationPressure: situationEvidence.situationPressure,
    exposurePressure: situationEvidence.exposurePressure,
    criticalExposureCount: situationEvidence.criticalExposureCount,
    nearestThreatKm: situationEvidence.nearestThreatKm,
    expiresAt: new Date(nowMs + ttlMs).toISOString(),
    updatedAt,
    generatedAt: nowIso(),
  };
};

app.get('/v1/operational/snapshot', async (req, res) => {
  try {
    const lat = parseFiniteQueryNumber(req.query?.lat);
    const lon = parseFiniteQueryNumber(req.query?.lon);
    const radiusKm = Math.max(
      5,
      Math.min(120, Number(req.query?.radiusKm || 35)),
    );
    const hasLatLon = Number.isFinite(lat) && Number.isFinite(lon);
    const bbox = hasLatLon ? bboxFromPoint(lat, lon, radiusKm) : null;

    const payload = await EventHubService.getEvents(
      {
        bbox: bbox
          ? [
              bbox.minLon.toFixed(4),
              bbox.minLat.toFixed(4),
              bbox.maxLon.toFixed(4),
              bbox.maxLat.toFixed(4),
            ].join(',')
          : req.query?.bbox,
        types: req.query?.types,
        country: req.query?.country,
        since: req.query?.since,
        sosPublicOptIn: req.query?.sosPublicOptIn,
        limit: req.query?.limit || 160,
      },
      { db },
    );

    const snapshot = computeOperationalSnapshot(payload, {
      userLocation: hasLatLon ? { latitude: lat, longitude: lon } : null,
      radiusKm,
    });
    return res.json({
      snapshot,
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
        cacheHit: Boolean(payload?.meta?.cacheHit),
        source: 'event_hub',
      },
    });
  } catch (error) {
    console.error('[v1/operational/snapshot]', error);
    return res.status(500).json({
      error: 'operational_snapshot_internal',
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
      },
    });
  }
});

app.get('/v1/events', async (req, res) => {
  try {
    const payload = await EventHubService.getEvents(
      {
        bbox: req.query?.bbox,
        types: req.query?.types,
        since: req.query?.since,
        country: req.query?.country,
        sosPublicOptIn: req.query?.sosPublicOptIn,
        limit: req.query?.limit,
      },
      { db },
    );
    return res.json(payload);
  } catch (error) {
    console.error('[v1/events]', error);
    return res.status(500).json({
      error: 'event_hub_internal',
      events: [],
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
      },
    });
  }
});

app.get('/v1/health/top', async (req, res) => {
  try {
    const payload = await EventHubService.getHealthTop(
      {
        bbox: req.query?.bbox,
        country: req.query?.country,
      },
      { db },
    );
    return res.json(payload);
  } catch (error) {
    console.error('[v1/health/top]', error);
    return res.status(500).json({
      error: 'event_hub_health_internal',
      items: [],
      meta: {
        generatedAt: nowIso(),
        failClosed: true,
      },
    });
  }
});

app.get('/v1/providers/status', (_req, res) => {
  try {
    const payload = EventHubService.getProvidersStatus();
    return res.json(payload);
  } catch (error) {
    console.error('[v1/providers/status]', error);
    return res.status(500).json({
      error: 'event_hub_status_internal',
      providers: [],
      generatedAt: nowIso(),
    });
  }
});

const port = runtimeConfig.server.port;
const host = runtimeConfig.server.host;
const server = app.listen(port, host, () => {
  console.log(`Alert backend running on ${host}:${port}`);
});

server.on('error', error => {
  console.error('[bootstrap/server] failed to start listener', error);
  process.exit(1);
});
