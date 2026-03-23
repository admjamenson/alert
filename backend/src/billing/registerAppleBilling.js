/**
 * Apple Billing Routes
 * Endpoints for syncing App Store purchases and managing subscriptions
 */
const AppleBillingService = require('./appleBillingService');

const registerAppleBilling = (app, db, options = {}) => {
  const appleBillingService = new AppleBillingService(db);

  /**
   * POST /sync-apple-purchase
   * Sync an Apple App Store purchase with the backend
   *
   * Body:
   * {
   *   originalTransactionId: string,
   *   transactionId: string,
   *   bundleId: string,
   *   productId: string,
   *   purchaseTime: number (ms)
   * }
   */
  app.post('/sync-apple-purchase', async (req, res) => {
    try {
      const {
        originalTransactionId,
        transactionId,
        bundleId,
        productId,
        purchaseTime,
      } = req.body;

      // Extract user ID from auth header or billing token
      let userId = null;

      // Try to get from X-Alert-User-Id header (mobile app header)
      if (req.headers['x-alert-user-id']) {
        userId = String(req.headers['x-alert-user-id']).trim();
      }

      // Try to get from X-Alert-Billing-Token (signed request)
      if (!userId && req.headers['x-alert-billing-token']) {
        // In production, verify and decode the JWT token
        // For now, extract user ID from token payload
        try {
          // This would normally verify against issuer secret
          userId = req.headers['x-alert-billing-token'];
        } catch (error) {
          console.error('[AppleBillingRoute] Invalid billing token:', error);
        }
      }

      // Validate required fields
      if (!userId) {
        return res.status(400).json({
          error: 'missing_user_id',
          message: 'User ID is required',
        });
      }

      if (!originalTransactionId) {
        return res.status(400).json({
          error: 'missing_original_transaction_id',
          message: 'Original transaction ID is required',
        });
      }

      if (!transactionId) {
        return res.status(400).json({
          error: 'missing_transaction_id',
          message: 'Transaction ID is required',
        });
      }

      if (!bundleId) {
        return res.status(400).json({
          error: 'missing_bundle_id',
          message: 'Bundle ID is required',
        });
      }

      if (!productId) {
        return res.status(400).json({
          error: 'missing_product_id',
          message: 'Product ID is required',
        });
      }

      if (!purchaseTime || typeof purchaseTime !== 'number') {
        return res.status(400).json({
          error: 'invalid_purchase_time',
          message: 'Purchase time must be a valid number (milliseconds)',
        });
      }

      // Validate product ID format
      const validProducts = [
        'alert.premium.monthly',
        'alert.premium.annual',
        'alert.premium.lifetime',
      ];
      if (!validProducts.includes(productId)) {
        return res.status(400).json({
          error: 'invalid_product_id',
          message: `Product ID must be one of: ${validProducts.join(', ')}`,
        });
      }

      console.log(
        `[AppleBillingRoute] Syncing Apple purchase for user: ${userId}`,
      );

      // Sync with service
      const result = await appleBillingService.syncApplePurchase({
        userId,
        originalTransactionId,
        transactionId,
        bundleId,
        productId,
        purchaseTime,
      });

      // Return success response
      return res.status(200).json({
        success: true,
        provider: 'app_store',
        userId: result.userId,
        status: result.status,
        message: 'Purchase synced successfully',
      });
    } catch (error) {
      console.error('[AppleBillingRoute] Error:', error);

      const statusCode = error.message?.startsWith('missing_') ? 400 : 500;
      const errorCode = error.message || 'apple_billing_sync_failed';

      return res.status(statusCode).json({
        error: errorCode,
        message: error.message || 'Failed to sync Apple purchase',
      });
    }
  });

  /**
   * POST /restore-apple-purchases
   * Restore failed Apple purchases from iOS app
   * (Used when purchase was successful on iOS but sync to backend failed)
   */
  app.post('/restore-apple-purchases', async (req, res) => {
    try {
      const { originalTransactionId } = req.body;

      let userId = null;
      if (req.headers['x-alert-user-id']) {
        userId = String(req.headers['x-alert-user-id']).trim();
      }

      if (!userId) {
        return res.status(400).json({
          error: 'missing_user_id',
          message: 'User ID is required',
        });
      }

      if (!originalTransactionId) {
        return res.status(400).json({
          error: 'missing_original_transaction_id',
          message: 'Original transaction ID is required',
        });
      }

      console.log(
        `[AppleBillingRoute] Restoring purchases for user: ${userId}`,
      );

      // Look up existing billing record by transaction ID
      const existingRecord =
        await appleBillingService.getByOriginalTransactionId(
          originalTransactionId,
        );

      if (!existingRecord) {
        return res.status(404).json({
          error: 'transaction_not_found',
          message: 'No purchase found with this transaction ID',
        });
      }

      // Verify user ID matches (security)
      if (String(existingRecord.user_id) !== String(userId)) {
        return res.status(403).json({
          error: 'unauthorized_access',
          message: 'User ID does not match transaction owner',
        });
      }

      return res.status(200).json({
        success: true,
        provider: 'app_store',
        userId: existingRecord.user_id,
        status: existingRecord.subscription_status,
        currentPeriodEnd: existingRecord.current_period_end,
        message: 'Purchase restored successfully',
      });
    } catch (error) {
      console.error('[AppleBillingRoute] Restore error:', error);

      return res.status(500).json({
        error: 'apple_restore_failed',
        message: error.message || 'Failed to restore purchases',
      });
    }
  });

  /**
   * GET /apple-entitlement/:userId
   * Get current entitlement status for Apple billing
   */
  app.get('/apple-entitlement/:userId', async (req, res) => {
    try {
      const { userId } = req.params;

      if (!userId) {
        return res.status(400).json({
          error: 'missing_user_id',
          message: 'User ID is required',
        });
      }

      console.log(
        `[AppleBillingRoute] Getting entitlement for user: ${userId}`,
      );

      const entitlementDoc = await db
        .collection('entitlements')
        .doc(userId)
        .get();

      if (!entitlementDoc.exists) {
        return res.status(404).json({
          error: 'entitlement_not_found',
          message: 'No entitlement found for this user',
        });
      }

      const entitlementData = entitlementDoc.data();

      return res.status(200).json({
        success: true,
        provider: 'app_store',
        userId,
        isPremium: entitlementData.isPremium || false,
        status: entitlementData.subscriptionStatus || 'inactive',
        currentPeriodEnd: entitlementData.currentPeriodEnd || null,
      });
    } catch (error) {
      console.error('[AppleBillingRoute] Get entitlement error:', error);

      return res.status(500).json({
        error: 'get_entitlement_failed',
        message: error.message || 'Failed to get entitlement',
      });
    }
  });

  console.log('[AppleBillingRoute] Apple billing routes registered');
};

module.exports = registerAppleBilling;
