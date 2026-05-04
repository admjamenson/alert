jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../src/services/AlertRelayService', () => ({
  AlertRelayService: {
    sendSos: jest.fn(),
  },
}));

describe('KyberNetworkService', () => {
  const QUEUE_KEY = '@Alert:EmergencyQueue';

  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
  });

  it('accepts an SOS by queueing it when relay delivery fails', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const {AlertRelayService} = require('../src/services/AlertRelayService');
    AlertRelayService.sendSos.mockResolvedValue({
      ok: false,
      status: 503,
      data: null,
      retriesUsed: 0,
      latencyMs: 12,
    });

    const {KyberNetworkService} = require('../src/services/KyberNetworkService');
    const result = await KyberNetworkService.broadcastEmergency(
      {latitude: -8.05, longitude: -34.88},
      [{remoteId: 'guardian-1', name: 'Ana'}],
      'Paula',
    );

    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        delivered: false,
        queued: true,
        integrityProtected: true,
      }),
    );

    const rawQueue = await AsyncStorage.getItem(QUEUE_KEY);
    const queue = JSON.parse(rawQueue);
    expect(queue).toHaveLength(1);
    expect(queue[0].integrity).toEqual(
      expect.objectContaining({
        alg: 'sha256',
        version: 1,
      }),
    );
  });

  it('rehydrates queued payloads with legacy integrity digests before flush', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    const {AlertRelayService} = require('../src/services/AlertRelayService');
    AlertRelayService.sendSos.mockResolvedValueOnce({
      ok: false,
      status: 503,
      data: null,
      retriesUsed: 0,
      latencyMs: 9,
    });

    const {KyberNetworkService} = require('../src/services/KyberNetworkService');
    await KyberNetworkService.broadcastEmergency(
      {latitude: -8.05, longitude: -34.88},
      [{remoteId: 'guardian-1', name: 'Ana'}],
      'Paula',
    );

    const originalQueue = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY));
    const tampered = {
      ...originalQueue[0],
      id: 'sos-tampered',
    };
    await AsyncStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([tampered, originalQueue[0]]),
    );

    AlertRelayService.sendSos.mockResolvedValue({
      ok: true,
      status: 200,
      data: {relayId: 'relay-1'},
      retriesUsed: 0,
      latencyMs: 14,
    });

    await KyberNetworkService.flushPending();

    const queueAfterFlush = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY));
    expect(queueAfterFlush).toEqual([]);
    expect(AlertRelayService.sendSos).toHaveBeenCalledTimes(3);
    const lastFlushPayload = AlertRelayService.sendSos.mock.calls[1][0];
    expect(lastFlushPayload.integrity).toEqual(
      expect.objectContaining({
        alg: 'sha256',
        version: 1,
      }),
    );
    warnSpy.mockRestore();
  });
});
