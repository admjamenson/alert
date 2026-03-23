/**
 * App Store Server Notifications Routes
 * Endpoint for receiving App Store Server-to-Server Notifications
 */

const AppStoreServerNotificationsHandler = require('./appStoreServerNotifications');

const registerAppStoreNotifications = (app, db) => {
  const notificationsHandler = new AppStoreServerNotificationsHandler(db);

  /**
   * POST /app-store-notifications
   * Receive App Store Server Notifications (JWS format)
   *
   * Body: JSON with signedPayload field containing JWS token
   * {
   *   signedPayload: "<JWT string>"
   * }
   *
   * JWS payload inside contains:
   * {
   *   notificationUUID: string,
   *   timestamp: number,
   *   notificationType: "SUBSCRIBED" | "RENEWAL_EXTENDED" | "EXPIRED" | "REVOKED" | "REFUND" | etc,
   *   data: {
   *     userId: string (from appAccountToken),
   *     bundleId: string,
   *     originalTransactionId: string,
   *     productId: string,
   *     expiresDate: string (ISO 8601),
   *     subscriptionGroupIdentifier: string
   *   }
   * }
   */
  app.post('/app-store-notifications', async (req, res) => {
    const startedAt = Date.now();

    try {
      const { signedPayload } = req.body || {};

      if (!signedPayload || typeof signedPayload !== 'string') {
        console.error(
          '[AppStoreNotificationsRoute] Missing or invalid signedPayload',
        );
        return res.status(400).json({
          error: 'missing_signed_payload',
          message: 'signedPayload is required',
        });
      }

      console.log(
        `[AppStoreNotificationsRoute] Received notification, processing...`,
      );

      // Process notification
      const result = await notificationsHandler.processNotification(
        signedPayload,
      );

      if (result.status === 'idempotent') {
        // Idempotent: already processed, but still return 200
        console.log(
          `[AppStoreNotificationsRoute] Notification ${result.notificationId} was idempotent`,
        );
        return res.status(200).json({
          success: true,
          notificationId: result.notificationId,
          idempotent: true,
          message: 'Notification already processed',
          processingTimeMs: Date.now() - startedAt,
        });
      }

      console.log(
        `[AppStoreNotificationsRoute] Notification ${result.notificationId} processed successfully`,
      );

      return res.status(200).json({
        success: true,
        notificationId: result.notificationId,
        idempotent: false,
        message: 'Notification received and processed',
        processingTimeMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.error(
        '[AppStoreNotificationsRoute] Error processing notification:',
        error,
      );

      const isValidationError =
        error.message?.includes('Signature verification') ||
        error.message?.includes('Invalid JWS') ||
        error.message?.includes('Missing required');

      const statusCode = isValidationError ? 400 : 500;
      const errorCode = isValidationError
        ? 'notification_validation_failed'
        : 'notification_process_failed';

      return res.status(statusCode).json({
        error: errorCode,
        message: error.message || 'Failed to process notification',
        processingTimeMs: Date.now() - startedAt,
      });
    }
  });

  console.log(
    '[AppStoreNotificationsRoute] App Store notifications routes registered',
  );
};

module.exports = registerAppStoreNotifications;
