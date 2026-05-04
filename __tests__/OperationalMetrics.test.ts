import {
  clearOperationalMetrics,
  getOperationalMetricsSnapshot,
  recordOperationalMetric,
} from '../src/observability/OperationalMetrics';

describe('OperationalMetrics', () => {
  beforeEach(() => {
    clearOperationalMetrics();
  });

  it('keeps bounded non-sensitive metrics', () => {
    recordOperationalMetric('network_request_ms', 42, {
      path: '/v1/feed/weather',
      status: 200,
      latitude: -3.7,
      token: 'secret',
      ok: true,
    });

    const snapshot = getOperationalMetricsSnapshot();

    expect(snapshot).toHaveLength(1);
    expect(snapshot[0].name).toBe('network_request_ms');
    expect(snapshot[0].value).toBe(42);
    expect(snapshot[0].payload).toEqual({
      path: '/v1/feed/weather',
      status: 200,
      ok: true,
    });
  });
});

