const admin = require('firebase-admin');

const premiumActiveForStatus = status => {
  const normalized = String(status || '').toLowerCase();
  return normalized === 'active' || normalized === 'trialing';
};

const normalizePeriodEnd = value => {
  if (!value) return null;
  if (value && typeof value.toDate === 'function') {
    return value.toDate();
  }
  if (typeof value === 'number') {
    return new Date(value * 1000);
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return null;
};

const toFirestoreTimestamp = value => {
  const normalized = normalizePeriodEnd(value);
  if (!normalized) return null;
  return admin.firestore.Timestamp.fromDate(normalized);
};

const toIsoString = value => {
  const normalized = normalizePeriodEnd(value);
  return normalized ? normalized.toISOString() : null;
};

const serializeRecord = record => {
  if (!record || typeof record !== 'object') return record;
  return {
    ...record,
    current_period_end: toIsoString(record.current_period_end),
    premium_updated_at: toIsoString(record.premium_updated_at || record.updated_at),
    updated_at: toIsoString(record.updated_at) || String(record.updated_at || ''),
  };
};

class StripeBillingRepository {
  constructor(db) {
    this.db = db;
    this.subscriptions = db.collection('billing_subscriptions');
    this.entitlements = db.collection('entitlements');
    this.webhookEvents = db.collection('billing_webhook_events');
  }

  async getByUserId(userId) {
    if (!userId) return null;
    const doc = await this.subscriptions.doc(String(userId)).get();
    return doc.exists ? serializeRecord(doc.data()) : null;
  }

  async findByCustomerId(customerId) {
    if (!customerId) return null;
    const snapshot = await this.subscriptions
      .where('stripe_customer_id', '==', String(customerId))
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return serializeRecord(snapshot.docs[0].data());
  }

  async findBySubscriptionId(subscriptionId) {
    if (!subscriptionId) return null;
    const snapshot = await this.subscriptions
      .where('stripe_subscription_id', '==', String(subscriptionId))
      .limit(1)
      .get();
    if (snapshot.empty) return null;
    return serializeRecord(snapshot.docs[0].data());
  }

  async syncSubscription({
    userId,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId,
    subscriptionStatus,
    currentPeriodEnd,
    premiumActive,
    billingCurrency,
    billingCountryCode,
    billingLocale,
    billingCityName,
    billingMarketTier,
    billingMarketKey,
    sourceEvent,
  }) {
    const existing =
      (await this.getByUserId(userId)) ||
      (await this.findBySubscriptionId(stripeSubscriptionId)) ||
      (await this.findByCustomerId(stripeCustomerId));

    const stableUserId = String(userId || existing?.user_id || '').trim();
    if (!stableUserId) {
      throw new Error('missing_stable_user_id');
    }

    const normalizedStatus = String(
      subscriptionStatus || existing?.subscription_status || 'inactive',
    )
      .trim()
      .toLowerCase();
    const normalizedPremium =
      typeof premiumActive === 'boolean'
        ? premiumActive
        : premiumActiveForStatus(normalizedStatus);
    const normalizedPeriodEnd =
      toFirestoreTimestamp(currentPeriodEnd) ||
      toFirestoreTimestamp(existing?.current_period_end) ||
      null;
    const normalizedUpdatedAt = admin.firestore.Timestamp.now();

    const payload = {
      user_id: stableUserId,
      billing_provider: existing?.billing_provider || 'stripe',
      provider_customer_id:
        stripeCustomerId ||
        existing?.provider_customer_id ||
        existing?.stripe_customer_id ||
        null,
      provider_subscription_id:
        stripeSubscriptionId ||
        existing?.provider_subscription_id ||
        existing?.stripe_subscription_id ||
        null,
      provider_price_id:
        stripePriceId ||
        existing?.provider_price_id ||
        existing?.stripe_price_id ||
        null,
      original_transaction_id: existing?.original_transaction_id || null,
      stripe_customer_id:
        stripeCustomerId || existing?.stripe_customer_id || null,
      stripe_subscription_id:
        stripeSubscriptionId || existing?.stripe_subscription_id || null,
      stripe_price_id: stripePriceId || existing?.stripe_price_id || null,
      billing_currency: billingCurrency || existing?.billing_currency || null,
      billing_country_code: billingCountryCode || existing?.billing_country_code || null,
      billing_locale: billingLocale || existing?.billing_locale || null,
      billing_city_name: billingCityName || existing?.billing_city_name || null,
      billing_market_tier: billingMarketTier || existing?.billing_market_tier || null,
      billing_market_key: billingMarketKey || existing?.billing_market_key || null,
      subscription_status: normalizedStatus,
      current_period_end: normalizedPeriodEnd,
      premium_active: normalizedPremium,
      premium_updated_at: normalizedUpdatedAt,
      last_source_event: sourceEvent || null,
      updated_at: normalizedUpdatedAt,
    };

    await this.subscriptions.doc(stableUserId).set(payload, { merge: true });
    await this.entitlements.doc(stableUserId).set(
      {
        plan: normalizedPremium ? 'premium' : 'free',
        premium: normalizedPremium,
        billingProvider: payload.billing_provider || 'stripe',
        providerCustomerId: payload.provider_customer_id || payload.stripe_customer_id || null,
        providerSubscriptionId:
          payload.provider_subscription_id || payload.stripe_subscription_id || null,
        providerPriceId: payload.provider_price_id || payload.stripe_price_id || null,
        stripeCustomerId: payload.stripe_customer_id,
        stripeSubscriptionId: payload.stripe_subscription_id,
        stripePriceId: payload.stripe_price_id,
        billingCurrency: payload.billing_currency,
        billingCountryCode: payload.billing_country_code,
        billingLocale: payload.billing_locale,
        billingCityName: payload.billing_city_name,
        billingMarketTier: payload.billing_market_tier,
        billingMarketKey: payload.billing_market_key,
        subscriptionStatus: payload.subscription_status,
        expiresAt: payload.current_period_end,
        premiumUpdatedAt: payload.premium_updated_at || payload.updated_at,
        updatedAt: payload.updated_at,
        source: payload.billing_provider || 'stripe',
      },
      { merge: true },
    );

    return serializeRecord(payload);
  }

  async upsertCustomerProfile({
    userId,
    stripeCustomerId,
    billingCurrency,
    billingCountryCode,
    billingLocale,
    billingCityName,
    billingMarketTier,
    billingMarketKey,
    sourceEvent,
  }) {
    const stableUserId = String(userId || '').trim();
    const stableCustomerId = String(stripeCustomerId || '').trim();
    if (!stableUserId || !stableCustomerId) {
      throw new Error('missing_customer_profile_identity');
    }

    const existing = (await this.getByUserId(stableUserId)) || {};
    const updatedAt = admin.firestore.Timestamp.now();

    await this.subscriptions.doc(stableUserId).set(
      {
        user_id: stableUserId,
        billing_provider: existing.billing_provider || 'stripe',
        provider_customer_id:
          stableCustomerId ||
          existing.provider_customer_id ||
          existing.stripe_customer_id ||
          null,
        stripe_customer_id: stableCustomerId,
        billing_currency: billingCurrency || existing.billing_currency || null,
        billing_country_code: billingCountryCode || existing.billing_country_code || null,
        billing_locale: billingLocale || existing.billing_locale || null,
        billing_city_name: billingCityName || existing.billing_city_name || null,
        billing_market_tier: billingMarketTier || existing.billing_market_tier || null,
        billing_market_key: billingMarketKey || existing.billing_market_key || null,
        updated_at: updatedAt,
        last_source_event: sourceEvent || existing.last_source_event || null,
      },
      { merge: true },
    );

    await this.entitlements.doc(stableUserId).set(
      {
        billingProvider: 'stripe',
        providerCustomerId: stableCustomerId,
        stripeCustomerId: stableCustomerId,
        billingCurrency: billingCurrency || existing.billing_currency || null,
        billingCountryCode: billingCountryCode || existing.billing_country_code || null,
        billingLocale: billingLocale || existing.billing_locale || null,
        billingCityName: billingCityName || existing.billing_city_name || null,
        billingMarketTier: billingMarketTier || existing.billing_market_tier || null,
        billingMarketKey: billingMarketKey || existing.billing_market_key || null,
        premiumUpdatedAt: existing.updated_at || updatedAt,
        updatedAt,
        source: 'stripe',
      },
      { merge: true },
    );
  }

  async claimWebhookEvent({ eventId, eventType, objectId, requestIdempotencyKey }) {
    const stableEventId = String(eventId || '').trim();
    if (!stableEventId) {
      throw new Error('missing_webhook_event_id');
    }

    const eventRef = this.webhookEvents.doc(stableEventId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(eventRef);
      const now = admin.firestore.Timestamp.now();

      if (!snapshot.exists) {
        transaction.set(eventRef, {
          event_id: stableEventId,
          event_type: String(eventType || '').trim() || 'unknown',
          object_id: String(objectId || '').trim() || null,
          request_idempotency_key: String(requestIdempotencyKey || '').trim() || null,
          status: 'processing',
          attempt_count: 1,
          first_seen_at: now,
          processing_started_at: now,
          updated_at: now,
        });
        return { alreadyProcessed: false, status: 'processing' };
      }

      const existing = snapshot.data() || {};
      if (existing.status === 'processed') {
        return { alreadyProcessed: true, status: 'processed' };
      }

      transaction.set(
        eventRef,
        {
          event_type: String(eventType || existing.event_type || '').trim() || 'unknown',
          object_id: String(objectId || existing.object_id || '').trim() || null,
          request_idempotency_key:
            String(requestIdempotencyKey || existing.request_idempotency_key || '').trim() || null,
          status: 'processing',
          attempt_count: Number(existing.attempt_count || 0) + 1,
          processing_started_at: now,
          updated_at: now,
        },
        { merge: true },
      );

      return { alreadyProcessed: false, status: 'processing' };
    });
  }

  async markWebhookEventProcessed({ eventId, result }) {
    const stableEventId = String(eventId || '').trim();
    if (!stableEventId) return;
    await this.webhookEvents.doc(stableEventId).set(
      {
        status: 'processed',
        processed_at: admin.firestore.Timestamp.now(),
        updated_at: admin.firestore.Timestamp.now(),
        result: result || null,
      },
      { merge: true },
    );
  }

  async markWebhookEventFailed({ eventId, errorMessage }) {
    const stableEventId = String(eventId || '').trim();
    if (!stableEventId) return;
    await this.webhookEvents.doc(stableEventId).set(
      {
        status: 'failed',
        updated_at: admin.firestore.Timestamp.now(),
        last_error: String(errorMessage || '').trim() || 'unknown_error',
      },
      { merge: true },
    );
  }
}

module.exports = {
  StripeBillingRepository,
  premiumActiveForStatus,
};
