const resolveRequestIdentity = req => {
  const query = req?.query || {};
  const body = req?.body || {};
  const userIdRaw =
    query.userId ||
    body.userId ||
    req?.headers?.['x-alert-user-id'] ||
    req?.headers?.['x-alert-device-id'];
  const deviceIdRaw =
    query.deviceId ||
    body.deviceId ||
    req?.headers?.['x-alert-device-id'] ||
    req?.headers?.['x-device-id'];

  const userId = String(userIdRaw || '').trim();
  const deviceId = String(deviceIdRaw || '').trim();

  return {
    userId: userId || deviceId || `anon-${Date.now()}`,
    deviceId: deviceId || userId || `anon-device-${Date.now()}`,
  };
};

module.exports = {
  resolveRequestIdentity,
};
