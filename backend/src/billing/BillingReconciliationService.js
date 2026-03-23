/**
 * Billing Reconciliation Service
 * Reconciles entitlements across iOS, Apple servers, and backend Firestore
 * Enforces backend as source of truth for premium_active
 */

const AppStoreServerAPIClient = require('./AppStoreServerAPIClient');
const PremiumBillingUnifier = require('../../../src/domain/billing/PremiumBillingUnifier');

class BillingReconciliationService {
  constructor(db, appStoreAPIClient) {
    this.db = db;
    this.appStoreAPIClient = appStoreAPIClient;
    this.subscriptions = db.collection('billing_subscriptions');
    this.entitlements = db.collection('entitlements');
    this.reconciliationAudit = db.collection('billing_reconciliation_audit');
  }

  /**
   * Reconcile user's billing data across all sources
   * Priority: Apple Servers > Firestore > Local client cache
   */
  async reconcileUserBilling(userId) {
    try {
      console.log(
        `[BillingReconciliation] Reconciling billing for user=${userId}`,
      );

      // Step 1: Get current Firestore state
      const firestoreRecord = await this.subscriptions
        .doc(String(userId))
        .get();
      const currentRecord = firestoreRecord.exists
        ? firestoreRecord.data()
        : null;

      // Step 2: If App Store, query API for latest status
      if (currentRecord && currentRecord.billing_provider === 'app_store') {
        try {
          const originalTransactionId = currentRecord.original_transaction_id;
          if (!originalTransactionId) {
            throw new Error('Missing original_transaction_id');
          }

          // Query Apple servers
          const appleStatus = await this.appStoreAPIClient.getSubscriptionStatus(
            originalTransactionId,
          );

          // Reconcile: Apple Truth > Firestore
          return await this.applyReconciliation(
            userId,
            currentRecord,
            appleStatus,
          );
        } catch (error) {
          console.error(
            `[BillingReconciliation] Failed to query Apple for user=${userId}:`,
            error,
          );

          // Fallback: assume Firestore is accurate, but log the issue
          await this.writeReconciliationAudit(userId, 'error', {
            reason: 'apple_query_failed',
            error: error.message,
          });

          // Mark entitlement based on Firestore
          return await this.synchronizeEntitlementFromRecord(
            userId,
            currentRecord,
          );
        }
      }

      // Step 3: For non-App Store, just ensure entitlements are synced
      if (currentRecord) {
        return await this.synchronizeEntitlementFromRecord(
          userId,
          currentRecord,
        );
      }

      // No record exists
      console.log(
        `[BillingReconciliation] No billing record for user=${userId}`,
      );
      await this.entitlements.doc(String(userId)).set(
        {
          user_id: String(userId),
          isPremium: false,
          subscriptionStatus: 'inactive',
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );

      return { status: 'no_record', userId };
    } catch (error) {
      console.error(
        `[BillingReconciliation] Reconciliation failed for user=${userId}:`,
        error,
      );

      await this.writeReconciliationAudit(userId, 'error', {
        reason: 'reconciliation_failed',
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Compare Apple status with Firestore and apply reconciliation
   */
  async applyReconciliation(userId, firestoreRecord, appleStatus) {
    try {
      // Decode Apple status
      // In production: decode JWT and verify signature
      const appleData = this.decodeAppleStatus(appleStatus);

      // Determine canonical status
      const normalizedStatus = PremiumBillingUnifier.normalizeStatus(
        appleData.subscriptionStatus || firestoreRecord.subscription_status,
      );
      const isPremium =
        PremiumBillingUnifier.derivePremiumActive(normalizedStatus);

      // Check for mismatch
      const firestorePremium = firestoreRecord.premium_active || false;
      const mismatched = isPremium !== firestorePremium;

      if (mismatched) {
        console.log(
          `[BillingReconciliation] Mismatch detected for user=${userId}: Apple=${isPremium} vs Firestore=${firestorePremium}`,
        );
      }

      // Update Firestore with Apple truth
      const update = {
        subscription_status: normalizedStatus,
        premium_active: isPremium,
        premium_updated_at: new Date().toISOString(),
        current_period_end: appleData.currentPeriodEnd
          ? new Date(appleData.currentPeriodEnd)
          : firestoreRecord.current_period_end,
        updated_at: new Date().toISOString(),
        last_reconciled_at: new Date().toISOString(),
      };

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      // Synchronize entitlements
      await this.entitlements.doc(String(userId)).set(
        {
          user_id: String(userId),
          isPremium,
          subscriptionStatus: normalizedStatus,
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );

      await this.writeReconciliationAudit(userId, 'reconciled', {
        reason: mismatched ? 'mismatch_fixed' : 'verified',
        oldStatus: firestorePremium,
        newStatus: isPremium,
        normalizedStatus,
      });

      return {
        status: 'reconciled',
        userId,
        isPremium,
        subscriptionStatus: normalizedStatus,
        mismatched,
      };
    } catch (error) {
      console.error(
        `[BillingReconciliation] Reconciliation apply failed:`,
        error,
      );

      await this.writeReconciliationAudit(userId, 'error', {
        reason: 'apply_failed',
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Decode Apple subscription status data
   * In production: verify JWT signature first
   */
  decodeAppleStatus(appleStatus) {
    try {
      // Placeholder: in production, use jwt.verify() to decode and verify
      if (!appleStatus || typeof appleStatus !== 'object') {
        return {};
      }

      // Extract relevant fields from Apple response
      return {
        subscriptionStatus: appleStatus.subscriptionStatus || 'unknown',
        expiresDate: appleStatus.expiresDate || null,
        currentPeriodEnd: appleStatus.currentPeriodEnd || null,
        originalTransactionId: appleStatus.originalTransactionId || null,
      };
    } catch (error) {
      console.error(
        '[BillingReconciliation] Decode Apple status failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Synchronize entitlements from Firestore record
   * Ensures entitlements collection matches billing_subscriptions
   */
  async synchronizeEntitlementFromRecord(userId, record) {
    try {
      const normalizedStatus = PremiumBillingUnifier.normalizeStatus(
        record.subscription_status,
      );
      const isPremium =
        PremiumBillingUnifier.derivePremiumActive(normalizedStatus);

      await this.entitlements.doc(String(userId)).set(
        {
          user_id: String(userId),
          isPremium,
          billingProvider: record.billing_provider || 'unknown',
          subscriptionStatus: normalizedStatus,
          currentPeriodEnd: record.current_period_end
            ? new Date(record.current_period_end).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        },
        { merge: true },
      );

      return {
        status: 'synchronized',
        userId,
        isPremium,
        subscriptionStatus: normalizedStatus,
      };
    } catch (error) {
      console.error(
        `[BillingReconciliation] Synchronize entitlement failed for user=${userId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Write reconciliation audit trail
   */
  async writeReconciliationAudit(userId, result, details) {
    try {
      const auditId = `${userId}_${Date.now()}`;
      await this.reconciliationAudit.doc(auditId).set({
        userId: String(userId),
        result,
        details,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Retain 30 days
      });
    } catch (error) {
      console.error('[BillingReconciliation] Audit write failed:', error);
      // Don't throw - audit failure shouldn't block reconciliation
    }
  }

  /**
   * Bulk reconciliation for all active subscriptions
   * Should be run periodically (e.g., daily via Cloud Scheduler)
   */
  async reconcileAllUsers() {
    try {
      console.log('[BillingReconciliation] Starting bulk reconciliation');

      const snapshot = await this.subscriptions
        .where('billing_provider', '==', 'app_store')
        .where('premium_active', '==', true)
        .get();

      const tasks = [];
      let successCount = 0;
      let errorCount = 0;

      snapshot.docs.forEach(doc => {
        const userId = doc.id;
        tasks.push(
          this.reconcileUserBilling(userId)
            .then(() => {
              successCount += 1;
            })
            .catch(() => {
              errorCount += 1;
            }),
        );
      });

      await Promise.all(tasks);

      console.log(
        `[BillingReconciliation] Bulk reconciliation complete: ${successCount} success, ${errorCount} errors out of ${snapshot.size} users`,
      );

      return {
        totalProcessed: snapshot.size,
        successCount,
        errorCount,
      };
    } catch (error) {
      console.error(
        '[BillingReconciliation] Bulk reconciliation failed:',
        error,
      );
      throw error;
    }
  }
}

module.exports = BillingReconciliationService;
