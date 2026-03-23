/**
 * Apple Billing Service
 * Handles synchronization of Apple App Store purchases with Firestore
 */
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

const toIsoString = value => {
  const normalized = normalizePeriodEnd(value);
  return normalized ? normalized.toISOString() : null;
};

class AppleBillingService {
  constructor(db) {
    this.db = db;
    this.subscriptions = db.collection('billing_subscriptions');
    this.entitlements = db.collection('entitlements');
  }

  /**
   * Map Apple product IDs to subscription plans
   */
  mapProductToPlan(productId) {
    const productMap = {
      'alert.premium.monthly': { plan: 'monthly', interval: 'month' },
      'alert.premium.annual': { plan: 'annual', interval: 'year' },
      'alert.premium.lifetime': { plan: 'lifetime', interval: null },
    };
    return productMap[productId] || { plan: 'unknown', interval: null };
  }

  /**
   * Sync Apple purchase with Firestore
   * Updates or creates billing record with App Store data
   */
  async syncApplePurchase({
    userId,
    originalTransactionId,
    transactionId,
    bundleId,
    productId,
    purchaseTime,
  }) {
    if (!userId) {
      throw new Error('missing_user_id');
    }

    if (!originalTransactionId) {
      throw new Error('missing_original_transaction_id');
    }

    try {
      console.log(
        `[AppleBillingService] Syncing purchase for user=${userId} transactionId=${originalTransactionId}`,
      );

      const existing = await this.subscriptions.doc(String(userId)).get();
      const existingData = existing.exists ? existing.data() : null;

      const planInfo = this.mapProductToPlan(productId);
      const now = new Date();
      const purchaseTimeDate = new Date(purchaseTime);

      // Estimate subscription period end based on plan type
      let estimatedPeriodEnd = null;
      if (planInfo.interval === 'month') {
        estimatedPeriodEnd = new Date(purchaseTimeDate);
        estimatedPeriodEnd.setMonth(estimatedPeriodEnd.getMonth() + 1);
      } else if (planInfo.interval === 'year') {
        estimatedPeriodEnd = new Date(purchaseTimeDate);
        estimatedPeriodEnd.setFullYear(estimatedPeriodEnd.getFullYear() + 1);
      } else if (planInfo.plan === 'lifetime') {
        // Lifetime: set to far future (10 years)
        estimatedPeriodEnd = new Date(purchaseTimeDate);
        estimatedPeriodEnd.setFullYear(estimatedPeriodEnd.getFullYear() + 10);
      }

      const billingRecord = {
        user_id: String(userId),
        billing_provider: 'app_store',
        provider_customer_id: bundleId,
        provider_subscription_id: originalTransactionId,
        provider_price_id: productId,
        original_transaction_id: originalTransactionId,
        transaction_id: transactionId,

        // Keep Stripe fields for backwards compatibility
        stripe_customer_id: existingData?.stripe_customer_id || null,
        stripe_subscription_id: existingData?.stripe_subscription_id || null,
        stripe_price_id: existingData?.stripe_price_id || null,

        // Billing info
        billing_currency: 'USD', // Will be refined with App Receipt validation
        billing_country_code: existingData?.billing_country_code || null,
        billing_locale: existingData?.billing_locale || null,
        billing_city_name: existingData?.billing_city_name || null,
        billing_market_tier: existingData?.billing_market_tier || null,
        billing_market_key: existingData?.billing_market_key || null,

        // Subscription status
        subscription_status: 'active',
        subscription_plan: planInfo.plan,
        current_period_end:
          admin.firestore.Timestamp.fromDate(estimatedPeriodEnd),
        premium_active: true,
        premium_updated_at: admin.firestore.Timestamp.fromDate(now),
        updated_at: admin.firestore.Timestamp.fromDate(now),
      };

      // Write to Firestore
      await this.subscriptions
        .doc(String(userId))
        .set(billingRecord, { merge: true });

      // Update entitlements collection for fast access
      const entitlementRecord = {
        user_id: String(userId),
        isPremium: true,
        isPremiumActive: true,
        billingProvider: 'app_store',
        subscriptionStatus: 'active',
        currentPeriodEnd: estimatedPeriodEnd.toISOString(),
        updated_at: admin.firestore.Timestamp.fromDate(now),
      };

      await this.entitlements
        .doc(String(userId))
        .set(entitlementRecord, { merge: true });

      console.log(
        `[AppleBillingService] Successfully synced purchase for user=${userId}`,
      );

      return {
        success: true,
        userId,
        provider: 'app_store',
        status: 'active',
      };
    } catch (error) {
      console.error(`[AppleBillingService] Sync failed:`, error);
      throw error;
    }
  }

  /**
   * Validate that original transaction ID format is valid
   */
  isValidOriginalTransactionId(value) {
    // Apple original transaction IDs are long numeric strings
    return /^\d{15,}$/.test(String(value || '').trim());
  }

  /**
   * Get billing record by original transaction ID
   */
  async getByOriginalTransactionId(originalTransactionId) {
    if (!originalTransactionId) return null;

    try {
      const snapshot = await this.subscriptions
        .where('original_transaction_id', '==', String(originalTransactionId))
        .limit(1)
        .get();

      if (snapshot.empty) return null;
      return snapshot.docs[0].data();
    } catch (error) {
      console.error('[AppleBillingService] Query failed:', error);
      return null;
    }
  }
}

module.exports = AppleBillingService;
