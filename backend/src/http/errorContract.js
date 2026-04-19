const buildErrorPayload = ({
  code,
  message,
  failClosed = true,
  retryable = true,
  reason = null,
  meta = {},
  data = {},
} = {}) => ({
  error: String(code || 'internal_error'),
  message: message ? String(message) : undefined,
  ...data,
  meta: {
    generatedAt: new Date().toISOString(),
    failClosed: Boolean(failClosed),
    retryable: Boolean(retryable),
    reason,
    ...meta,
  },
});

const sendJsonError = (res, status, options) =>
  res.status(status).json(buildErrorPayload(options));

module.exports = {
  buildErrorPayload,
  sendJsonError,
};
