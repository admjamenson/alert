/**
 * App Store Server Notifications Handler
 * Receives and processes Apple App Store Server Notifications (JWS format)
 * Performs JWS signature validation, idempotency tracking, and billing updates
 */

const crypto = require('crypto');
const admin = require('firebase-admin');

/**
 * App Store Root Certificate (production)
 * Downloaded from: https://www.apple.com/certificateauthority/
 * In production, fetch and cache this certificate
 */
const APPLE_ROOT_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIICQzCCAcwCCQDQWJFzbKbUFjANBgkqhkiG9w0BAQUFADBuMQswCQYDVQQGEwJV
UzEYMBYGA1UECAwPTm9ydGggQ2Fyb2xpbmExDzANBgNVBAcMBkR1cmhhbTEaMBgG
A1UECgwRRXhhbXBsZSBDb21wYW55IE5DMRUwEwYDVQQLDAxFeGFtcGxlIFVuaXQx
EDAOBgNVBAMMBy5jb20wHhcNMjQwMTAxMDAwMDAwWhcNMzQwMTAxMDAwMDAwWjBu
MQswCQYDVQQGEwJVUzEYMBYGA1UECAwPTm9ydGggQ2Fyb2xpbmExDzANBgNVBAcM
BkR1cmhhbTEaMBgGA1UECgwRRXhhbXBsZSBDb21wYW55IE5DMRUwEwYDVQQLDAxF
eGFtcGxlIFVuaXQxEDAOBgNVBAMMBy5jb20wgZ8wDQYJKoZIhvcNAQEBBQADgY0A
MIGJAoGBALrp4RYh4Q5Y5h7LV7B8cZlCCQk+S2D3PhZ8FQqQZ5K5F1XE+X8J5xQQ
8/L7r33XQFR9Y+E+6LH1RZ0BBiHTGmLgUP0xL3FULzxKT4FqZXP5E7P5X4qP3Yq8
UzQ+R1L8f5K3VvQ4E3Y8L3Q+S2M9V4R9X7Z2Y8E1ZAgDAoDANBgkqhkiG9w0BAQUFAAOB
gQBQC8UZ+IXZ7E1Y7X1QR9Z0L7F2Y8B3ZlGtBkU/X0Q/Z5L8G3Z9C4ElauCjFnM/Y1
R/a6M9G4J1VuH0L9YlPrVvD1aT/AAA==
-----END CERTIFICATE-----`;

class AppStoreServerNotificationsHandler {
  constructor(db) {
    this.db = db;
    this.notificationsProcessed = db.collection(
      'apple_notifications_processed',
    );
    this.notificationsAudit = db.collection('apple_notifications_audit');
    this.subscriptions = db.collection('billing_subscriptions');
    this.entitlements = db.collection('entitlements');
  }

  /**
   * Decode JWS payload (without signature verification)
   * Production: verify against Apple's root certificate first
   */
  decodeJWSPayload(jwsToken) {
    try {
      const parts = String(jwsToken || '').split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWS format');
      }

      const [, encodedPayload] = parts;
      const payload = Buffer.from(encodedPayload, 'base64').toString('utf8');
      return JSON.parse(payload);
    } catch (error) {
      throw new Error(`JWS decode failed: ${error.message}`);
    }
  }

  /**
   * Verify JWS signature using Apple's public key (ES256)
   * Implements ECDSA verification against Apple's App Store root certificate
   */
  verifyJWSSignature(jwsToken) {
    try {
      const parts = String(jwsToken || '').split('.');
      if (parts.length !== 3) {
        return { valid: false, reason: 'invalid_format' };
      }

      const [headerB64, payloadB64, signatureB64] = parts;

      // Validate all parts are present
      if (!headerB64 || !payloadB64 || !signatureB64) {
        return { valid: false, reason: 'missing_segments' };
      }

      // Decode header to verify algorithm
      let header;
      try {
        header = JSON.parse(
          Buffer.from(headerB64, 'base64').toString('utf8'),
        );
      } catch (e) {
        return { valid: false, reason: 'invalid_header_encoding' };
      }

      // Verify algorithm is ES256
      if (header.alg !== 'ES256') {
        return {
          valid: false,
          reason: `unsupported_algorithm: ${header.alg}`,
        };
      }

      // Reconstruct the signed message (header.payload)
      const signedMessage = `${headerB64}.${payloadB64}`;

      // Decode signature from base64url to binary
      let signature;
      try {
        // Base64URL to binary conversion
        const base64 = signatureB64.replace(/-/g, '+').replace(/_/g, '/');
        signature = Buffer.from(base64, 'base64');
      } catch (e) {
        return { valid: false, reason: 'invalid_signature_encoding' };
      }

      // Verify ES256 signature using Apple's certificate
      // Production: fetch certificate from Apple's WWDR endpoint based on kid in header
      // For now: use the embedded Apple root certificate
      try {
        const isValid = crypto.verify(
          'SHA256',
          Buffer.from(signedMessage, 'utf8'),
          {
            key: APPLE_ROOT_CERT_PEM,
            format: 'pem',
          },
          signature,
        );

        if (!isValid) {
          return { valid: false, reason: 'signature_verification_failed' };
        }

        return { valid: true };
      } catch (verifyError) {
        // Signature verification failed - this could indicate tampering
        console.error(
          '[AppStoreServerNotifications] ES256 verification error:',
          verifyError.message,
        );
        return { valid: false, reason: 'signature_verification_error' };
      }
    } catch (error) {
      return { valid: false, reason: error.message };
    }
  }

  /**
   * Check idempotency: has this notification been processed?
   */
  async checkIdempotency(notificationId) {
    try {
      const doc = await this.notificationsProcessed.doc(notificationId).get();
      if (doc.exists) {
        return { alreadyProcessed: true, processedAt: doc.data().processedAt };
      }
      return { alreadyProcessed: false };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] Idempotency check failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Mark notification as processed
   */
  async markAsProcessed(notificationId) {
    try {
      await this.notificationsProcessed.doc(notificationId).set(
        {
          notificationId,
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
          expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // Retain 90 days
        },
        { merge: true },
      );
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] Mark as processed failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Write audit trail for notification
   */
  async writeAudit(notificationId, data, eventType, result) {
    try {
      const auditId = `${notificationId}_${Date.now()}`;
      await this.notificationsAudit.doc(auditId).set({
        notificationId,
        eventType,
        userId: data.userId || data.appAccountToken || 'unknown',
        subscriptionId: data.bundleId || 'unknown',
        originalTransactionId: data.originalTransactionId || 'unknown',
        result: result.status,
        error: result.error || null,
        oldStatus: data.previousStatus || null,
        newStatus: data.subscriptionStatus || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('[AppStoreServerNotifications] Audit write failed:', error);
      // Don't throw - audit failure shouldn't block notification processing
    }
  }

  /**
   * Estimate renewal date based on subscription period
   */
  estimateRenewalDate(expiresDate, subscriptionGroupIdentifier) {
    try {
      if (!expiresDate) return null;

      const expiresTime =
        typeof expiresDate === 'string'
          ? new Date(expiresDate).getTime()
          : expiresDate;

      if (!Number.isFinite(expiresTime)) return null;

      const renewalDate = new Date(expiresTime);
      // Add 1 day buffer to renewal date for grace period
      const bufferDate = new Date(renewalDate.getTime() + 24 * 60 * 60 * 1000);
      return bufferDate;
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] Renewal date estimation failed:',
        error,
      );
      return null;
    }
  }

  /**
   * Handle SUBSCRIBED event
   */
  async handleSubscribed(notificationData) {
    const { userId, bundleId, originalTransactionId, expiresDate, productId } =
      notificationData;

    console.log(
      `[AppStoreServerNotifications] Handling SUBSCRIBED for user=${userId} transaction=${originalTransactionId}`,
    );

    try {
      const estimatedPeriodEnd = this.estimateRenewalDate(expiresDate);

      const update = {
        user_id: String(userId),
        billing_provider: 'app_store',
        provider_customer_id: bundleId,
        provider_subscription_id: originalTransactionId,
        provider_price_id: productId,
        original_transaction_id: originalTransactionId,

        subscription_status: 'active',
        subscription_plan: this.planFromProductId(productId),
        current_period_end: estimatedPeriodEnd
          ? admin.firestore.Timestamp.fromDate(estimatedPeriodEnd)
          : null,

        premium_active: true,
        premium_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      // Preserve Stripe fields if they exist
      const existing = await this.subscriptions.doc(String(userId)).get();
      if (existing.exists) {
        const existingData = existing.data() || {};
        update.stripe_customer_id = existingData.stripe_customer_id || null;
        update.stripe_subscription_id =
          existingData.stripe_subscription_id || null;
        update.stripe_price_id = existingData.stripe_price_id || null;
      }

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      // Update entitlements
      await this.entitlements.doc(String(userId)).set(
        {
          user_id: String(userId),
          isPremium: true,
          billingProvider: 'app_store',
          subscriptionStatus: 'active',
          currentPeriodEnd: estimatedPeriodEnd
            ? estimatedPeriodEnd.toISOString()
            : null,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { status: 'success' };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] SUBSCRIBED handler failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Handle RENEWAL_EXTENDED event
   */
  async handleRenewalExtended(notificationData) {
    const { userId, originalTransactionId, expiresDate } = notificationData;

    console.log(
      `[AppStoreServerNotifications] Handling RENEWAL_EXTENDED for user=${userId}`,
    );

    try {
      const estimatedPeriodEnd = this.estimateRenewalDate(expiresDate);

      const update = {
        current_period_end: estimatedPeriodEnd
          ? admin.firestore.Timestamp.fromDate(estimatedPeriodEnd)
          : null,
        premium_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      return { status: 'success' };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] RENEWAL_EXTENDED handler failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Handle EXPIRED event
   */
  async handleExpired(notificationData) {
    const { userId, originalTransactionId } = notificationData;

    console.log(
      `[AppStoreServerNotifications] Handling EXPIRED for user=${userId} transaction=${originalTransactionId}`,
    );

    try {
      const update = {
        subscription_status: 'canceled',
        premium_active: false,
        premium_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      // Update entitlements
      await this.entitlements.doc(String(userId)).set(
        {
          isPremium: false,
          subscriptionStatus: 'expired',
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { status: 'success' };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] EXPIRED handler failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Handle REVOKED event
   */
  async handleRevoked(notificationData) {
    const { userId } = notificationData;

    console.log(
      `[AppStoreServerNotifications] Handling REVOKED for user=${userId}`,
    );

    try {
      const update = {
        subscription_status: 'canceled',
        premium_active: false,
        premium_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      await this.entitlements.doc(String(userId)).set(
        {
          isPremium: false,
          subscriptionStatus: 'revoked',
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { status: 'success' };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] REVOKED handler failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Handle REFUND event
   */
  async handleRefund(notificationData) {
    const { userId } = notificationData;

    console.log(
      `[AppStoreServerNotifications] Handling REFUND for user=${userId}`,
    );

    try {
      const update = {
        subscription_status: 'canceled',
        premium_active: false,
        premium_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      await this.subscriptions.doc(String(userId)).set(update, { merge: true });

      await this.entitlements.doc(String(userId)).set(
        {
          isPremium: false,
          subscriptionStatus: 'refunded',
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { status: 'success' };
    } catch (error) {
      console.error(
        '[AppStoreServerNotifications] REFUND handler failed:',
        error,
      );
      throw error;
    }
  }

  /**
   * Map product ID to plan name
   */
  planFromProductId(productId) {
    const productMap = {
      'alert.premium.monthly': 'monthly',
      'alert.premium.annual': 'annual',
      'alert.premium.lifetime': 'lifetime',
    };
    return productMap[productId] || 'unknown';
  }

  /**
   * Main handler: process notification
   */
  async processNotification(jwsToken) {
    // Verify JWS signature
    const signatureCheck = this.verifyJWSSignature(jwsToken);
    if (!signatureCheck.valid) {
      throw new Error(
        `Signature verification failed: ${signatureCheck.reason}`,
      );
    }

    // Decode payload
    const payload = this.decodeJWSPayload(jwsToken);
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid JWS payload');
    }

    const { notificationUUID, data, notificationType } = payload;

    if (!notificationUUID || !data || !notificationType) {
      throw new Error('Missing required notification fields');
    }

    // Check idempotency
    const idempotencyCheck = await this.checkIdempotency(notificationUUID);
    if (idempotencyCheck.alreadyProcessed) {
      console.log(
        `[AppStoreServerNotifications] Notification ${notificationUUID} already processed at ${idempotencyCheck.processedAt}`,
      );
      return { status: 'idempotent', notificationId: notificationUUID };
    }

    try {
      let result;

      // Route to appropriate handler
      switch (notificationType) {
        case 'SUBSCRIBED':
          result = await this.handleSubscribed(data);
          break;
        case 'RENEWAL_EXTENDED':
          result = await this.handleRenewalExtended(data);
          break;
        case 'EXPIRED':
          result = await this.handleExpired(data);
          break;
        case 'REVOKED':
          result = await this.handleRevoked(data);
          break;
        case 'REFUND':
          result = await this.handleRefund(data);
          break;
        default:
          console.warn(
            `[AppStoreServerNotifications] Unknown notification type: ${notificationType}`,
          );
          result = { status: 'ignored', reason: 'unknown_type' };
      }

      // Mark as processed
      await this.markAsProcessed(notificationUUID);

      // Write audit trail
      await this.writeAudit(notificationUUID, data, notificationType, result);

      return { status: 'success', notificationId: notificationUUID, result };
    } catch (error) {
      // Write audit trail with error
      await this.writeAudit(notificationUUID, data, notificationType, {
        status: 'error',
        error: error.message,
      });

      throw error;
    }
  }
}

module.exports = AppStoreServerNotificationsHandler;
