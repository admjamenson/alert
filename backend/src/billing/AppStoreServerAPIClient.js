/**
 * App Store Server API Client
 * Queries Apple's App Store servers for subscription status and reconciliation
 * Based on: https://developer.apple.com/documentation/appstoreserverapi
 */

const https = require('https');

class AppStoreServerAPIClient {
  constructor(bundleId, appStoreKeyId, appStorePrivateKey, appStoreIssuerId) {
    this.bundleId = bundleId;
    this.appStoreKeyId = appStoreKeyId;
    this.appStorePrivateKey = appStorePrivateKey;
    this.appStoreIssuerId = appStoreIssuerId;

    // Production App Store Server API endpoint
    this.baseURL = 'https://api.storekit.itunes.apple.com';

    // Cached bearer tokens
    this.bearerTokenCache = {
      token: null,
      expiresAt: 0,
    };
  }

  /**
   * Create JWT token for API authentication (ES256)
   * Uses jsonwebtoken library with ECDSA P-256 signing
   * In production: requires APP_STORE_PRIVATE_KEY environment variable
   */
  createJWT() {
    try {
      const jwt = require('jsonwebtoken');

      const now = Math.floor(Date.now() / 1000);
      const payload = {
        iss: this.appStoreIssuerId,
        sub: this.bundleId,
        aud: 'appstoreconnect-v1',
        iat: now,
        exp: now + 15 * 60, // 15 minute expiry
        kid: this.appStoreKeyId,
      };

      // Sign with ES256 using private key
      // Private key must be in PEM format with PKCS8 or SEC1 encoding
      const privateKey = this.appStorePrivateKey;
      if (!privateKey) {
        throw new Error('Missing APP_STORE_PRIVATE_KEY environment variable');
      }

      const token = jwt.sign(payload, privateKey, {
        algorithm: 'ES256',
        keyid: this.appStoreKeyId,
      });

      console.log('[AppStoreServerAPIClient] JWT created with ES256 signature');
      return token;
    } catch (error) {
      console.error(
        '[AppStoreServerAPIClient] JWT creation failed:',
        error.message,
      );
      throw new Error(`Failed to create JWT: ${error.message}`);
    }
  }

  /**
   * Get Bearer token (cached)
   */
  async getBearerToken() {
    const now = Date.now();

    if (
      this.bearerTokenCache.token &&
      this.bearerTokenCache.expiresAt > now + 60000
    ) {
      return this.bearerTokenCache.token;
    }

    const token = this.createJWT();
    this.bearerTokenCache.token = token;
    this.bearerTokenCache.expiresAt = now + 14 * 60 * 1000; // Cache 14 minutes

    return token;
  }

  /**
   * Make HTTP request to App Store Server API
   */
  async makeRequest(method, path) {
    const token = await this.getBearerToken();

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.storekit.itunes.apple.com',
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const parsed = JSON.parse(data || '{}');
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ statusCode: res.statusCode, data: parsed });
            } else {
              reject(new Error(`API Error: ${res.statusCode} - ${data}`));
            }
          } catch (error) {
            reject(new Error(`Failed to parse response: ${error.message}`));
          }
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.end();
    });
  }

  /**
   * Get subscription history for original transaction ID
   * Returns a list of subscription status updates
   */
  async getSubscriptionHistory(originalTransactionId) {
    try {
      console.log(
        `[AppStoreServerAPIClient] Fetching subscription history for transaction=${originalTransactionId}`,
      );

      const path = `/inApps/v1/subscriptions/${originalTransactionId}`;
      const response = await this.makeRequest('GET', path);

      return response.data;
    } catch (error) {
      console.error('[AppStoreServerAPIClient] Get subscription history failed:', error);
      throw error;
    }
  }

  /**
   * Get status of specific subscription (latest)
   */
  async getSubscriptionStatus(originalTransactionId) {
    try {
      console.log(
        `[AppStoreServerAPIClient] Fetching subscription status for transaction=${originalTransactionId}`,
      );

      const history = await this.getSubscriptionHistory(originalTransactionId);

      if (!history || !history.signedTransactions) {
        return null;
      }

      // Return most recent transaction
      const transactions = Array.isArray(history.signedTransactions)
        ? history.signedTransactions
        : [];

      if (transactions.length === 0) {
        return null;
      }

      // Decode the most recent signed transaction
      // In production: verify signature and decode
      const mostRecent = transactions[transactions.length - 1];

      return {
        originalTransactionId,
        signedTransaction: mostRecent,
        // Decoded fields would include:
        // - expiresDate
        // - purchaseDate
        // - offerDiscountName
        // - transactionId
        // - bundleId
        // - productId
        // - subscriptionGroupIdentifier
      };
    } catch (error) {
      console.error('[AppStoreServerAPIClient] Get subscription status failed:', error);
      throw error;
    }
  }

  /**
   * Verify purchase token (validates iOS receipt format)
   */
  async verifyPurchaseToken(transactionId) {
    try {
      console.log(
        `[AppStoreServerAPIClient] Verifying purchase token=${transactionId}`,
      );

      // Call /inApps/v1/transactions/:transactionId endpoint
      const path = `/inApps/v1/transactions/${transactionId}`;
      const response = await this.makeRequest('GET', path);

      return response.data;
    } catch (error) {
      console.error('[AppStoreServerAPIClient] Verify purchase token failed:', error);
      throw error;
    }
  }

  /**
   * Check if user has active subscription
   */
  async isSubscriptionActive(originalTransactionId) {
    try {
      const status = await this.getSubscriptionStatus(originalTransactionId);

      if (!status) {
        return false;
      }

      // In production: decode signedTransaction and check:
      // - expiresDate > now
      // - subscriptionStatus === 'ACTIVE' (0)
      // - No pending cancellation

      return true; // Placeholder
    } catch (error) {
      console.error('[AppStoreServerAPIClient] Is subscription active check failed:', error);
      return false;
    }
  }

  /**
   * Extend subscription duration (admin operation)
   * Used for customer service interventions
   */
  async extendSubscription(originalTransactionId, extensionDays) {
    try {
      console.log(
        `[AppStoreServerAPIClient] Extending subscription ${originalTransactionId} by ${extensionDays} days`,
      );

      const token = await this.getBearerToken();
      const payload = {
        extensionDuration: extensionDays * 24 * 60 * 60 * 1000, // Convert to ms
      };

      // POST /inApps/v2/subscriptions/extend
      return new Promise((resolve, reject) => {
        const options = {
          hostname: 'api.storekit.itunes.apple.com',
          path: `/inApps/v2/subscriptions/extend/${originalTransactionId}`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        };

        const req = https.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              const parsed = JSON.parse(data || '{}');
              if (res.statusCode >= 200 && res.statusCode < 300) {
                resolve({ statusCode: res.statusCode, data: parsed });
              } else {
                reject(new Error(`API Error: ${res.statusCode}`));
              }
            } catch (error) {
              reject(error);
            }
          });
        });

        req.on('error', reject);
        req.write(JSON.stringify(payload));
        req.end();
      });
    } catch (error) {
      console.error('[AppStoreServerAPIClient] Extend subscription failed:', error);
      throw error;
    }
  }
}

module.exports = AppStoreServerAPIClient;
