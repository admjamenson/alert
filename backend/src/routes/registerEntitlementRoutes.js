const { resolveRequestIdentity } = require('../http/identity');
const {
  buildEntitlementSnapshot,
} = require('../services/EntitlementSnapshotService');
const { sendJsonError } = require('../http/errorContract');

const registerEntitlementRoutes = (app, deps = {}) => {
  const { db, config, logger = console } = deps;

  app.get('/api/me/entitlements', async (req, res) => {
    try {
      const identity = resolveRequestIdentity(req);
      const snapshot = await buildEntitlementSnapshot(
        {
          userId: identity.userId,
          deviceId: identity.deviceId,
          platform: req.query?.platform,
        },
        { db, config },
      );
      return res.json(snapshot);
    } catch (error) {
      logger.error('[entitlements]', error);
      return sendJsonError(res, 500, {
        code: 'entitlements_internal',
        retryable: true,
      });
    }
  });
};

module.exports = registerEntitlementRoutes;
