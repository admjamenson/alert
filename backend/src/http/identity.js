const readIdentityCandidate = (candidates = []) => {
  for (const candidate of candidates) {
    if (typeof candidate?.value !== 'string') continue;
    const normalized = candidate.value.trim();
    if (!normalized) continue;
    return {
      value: normalized,
      source: candidate.source,
    };
  }
  return {
    value: '',
    source: null,
  };
};

const resolveRequestIdentity = req => {
  const query = req?.query || {};
  const body = req?.body || {};
  const userIdCandidate = readIdentityCandidate([
    { value: query.userId, source: 'query.userId' },
    { value: body.userId, source: 'body.userId' },
    { value: req?.headers?.['x-alert-user-id'], source: 'header.x-alert-user-id' },
  ]);
  const deviceIdCandidate = readIdentityCandidate([
    { value: query.deviceId, source: 'query.deviceId' },
    { value: body.deviceId, source: 'body.deviceId' },
    { value: req?.headers?.['x-alert-device-id'], source: 'header.x-alert-device-id' },
    { value: req?.headers?.['x-device-id'], source: 'header.x-device-id' },
  ]);

  const userId = userIdCandidate.value;
  const deviceId = deviceIdCandidate.value;

  return {
    userId: userId || deviceId || `anon-${Date.now()}`,
    deviceId: deviceId || userId || `anon-device-${Date.now()}`,
    hasUserId: Boolean(userId),
    hasDeviceId: Boolean(deviceId),
    userIdSource: userIdCandidate.source,
    deviceIdSource: deviceIdCandidate.source,
    attributable: Boolean(userId || deviceId),
  };
};

module.exports = {
  resolveRequestIdentity,
};
