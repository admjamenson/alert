const {resolveRequestIdentity} = require('../http/identity');
const {
  buildEntitlementSnapshot,
} = require('../services/EntitlementSnapshotService');
const {sendJsonError} = require('../http/errorContract');
const {
  isLoadTestSafeMode,
  buildSafeModeEntitlementsPayload,
} = require('../config/safeMode');

const registerEntitlementRoutes = (app, deps = {}) => {
  const {
    db,
    config,
    logger = console,
    getReleaseControls,
    entitlementMetrics,
    markRequestMetric,
  } = deps;

  app.get('/api/me/entitlements', async (req, res) => {
    // HARD BYPASS em safe mode - responde imediatamente sem await
    if (isLoadTestSafeMode()) {
      return res.status(200).json(buildSafeModeEntitlementsPayload(req));
    }

    const startedAt = Date.now();
    try {
      const identity = resolveRequestIdentity(req);
      const snapshot = await buildEntitlementSnapshot(
        {
          userId: identity.userId,
          deviceId: identity.deviceId,
          platform: req.query?.platform,
        },
        {db, config},
      );
      if (typeof getReleaseControls === 'function') {
        const releaseControls = await getReleaseControls({
          userId: identity.userId,
          deviceId: identity.deviceId,
          platform: req.query?.platform,
          region: req.query?.region,
          segment: req.query?.segment,
        });
        if (releaseControls) {
          snapshot.featureFlags = {
            ...snapshot.featureFlags,
            ...(releaseControls.featureFlags || {}),
          };
          snapshot.release = releaseControls.release || null;
        }
      }
      if (typeof markRequestMetric === 'function') {
        markRequestMetric(entitlementMetrics, true, Date.now() - startedAt);
      }
      return res.json(snapshot);
    } catch (error) {
      if (typeof markRequestMetric === 'function') {
        markRequestMetric(entitlementMetrics, false, Date.now() - startedAt);
      }
      logger.error('[entitlements]', error);
      return sendJsonError(res, 500, {
        code: 'entitlements_internal',
        retryable: true,
      });
    }
  });
};

module.exports = registerEntitlementRoutes;
