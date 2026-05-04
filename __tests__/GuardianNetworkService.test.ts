jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({
    currentUser: null,
  })),
}));

jest.mock('@react-native-firebase/firestore', () => ({
  collection: jest.fn(),
  doc: jest.fn(),
  getDocs: jest.fn(),
  getFirestore: jest.fn(() => ({})),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  where: jest.fn(),
  writeBatch: jest.fn(() => ({
    set: jest.fn(),
    commit: jest.fn(),
  })),
}));

jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
}));

jest.mock('../src/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string) => key,
  },
}));

jest.mock('../src/services/NotificationService', () => ({
  NotificationService: {
    addGuardianRequest: jest.fn(),
    add: jest.fn(),
  },
}));

jest.mock('../src/services/ProfileService', () => ({
  ProfileService: {
    getProfile: jest.fn(async () => ({name: 'Paula'})),
  },
}));

jest.mock('../src/services/UserIdentityService', () => ({
  UserIdentityService: {
    getDeviceId: jest.fn(async () => 'device-123'),
    getUserPhone: jest.fn(async () => '+5511999999999'),
    normalizePhone: jest.fn((value: string) => {
      const digits = String(value || '').replace(/[^\d+]/g, '');
      if (!digits) return '';
      return digits.startsWith('+') ? digits : `+${digits}`;
    }),
  },
}));

jest.mock('../src/services/FirebaseAuthResilienceService', () => ({
  ensureAnonymousAuth: jest.fn(async () => false),
  getAnonymousAuthStatus: jest.fn(() => ({
    enabled: false,
    hasCurrentUser: false,
    hasCurrentUserId: false,
    blockedForSession: true,
    blockedUntilMs: 0,
  })),
}));

jest.mock('../src/core/config', () => ({
  getAlertApiBaseUrl: jest.fn(() => 'https://alert-vmpj.onrender.com'),
}));

describe('GuardianNetworkService', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn((key: string) =>
          key.toLowerCase() === 'x-alert-request-id' ? 'render-direct-req-1' : null,
        ),
      },
      json: async () => ({
        ok: true,
        requestId: 'render-direct-req-1',
        fanout: {
          queued: true,
          jobId: 'sos-job-1',
          tokenCount: 1,
          targetCount: 1,
          resolvedViaPhoneCount: 1,
        },
      }),
    })) as unknown as typeof fetch;
  });

  it('sends direct guardian SOS through the backend even when anonymous auth is unavailable', async () => {
    const {GuardianNetworkService} = require('../src/services/GuardianNetworkService');

    const result = await GuardianNetworkService.sendSosToGuardians({
      location: {latitude: -8.05, longitude: -34.88},
      senderName: 'Paula',
      message: 'SOS active',
      guardians: [{name: 'Ana', phone: '(11) 99999-9999'}],
    });

    expect(global.fetch).toHaveBeenCalledWith(
      'https://alert-vmpj.onrender.com/api/sos',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Alert-Request-Id': expect.stringMatching(/^guardian-sos-/),
        }),
        body: JSON.stringify({
          fromId: 'device_device-123',
          fromName: 'Paula',
          message: 'SOS active',
          location: {latitude: -8.05, longitude: -34.88},
          targets: [],
          targetPhones: ['+11999999999'],
        }),
      }),
    );
    expect(result).toEqual({
      ok: true,
      accepted: true,
      delivered: true,
      requestId: 'render-direct-req-1',
      jobId: 'sos-job-1',
    });
  });

  it('treats backend acceptance without fanout as a fallback case, not a full direct delivery', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      status: 200,
      headers: {
        get: jest.fn(() => 'render-direct-req-2'),
      },
      json: async () => ({
        ok: true,
        requestId: 'render-direct-req-2',
        fanout: {
          mode: 'none',
          queued: false,
          sentInline: false,
          deduped: false,
          tokenCount: 0,
          targetCount: 1,
        },
      }),
    })) as unknown as typeof fetch;

    const {GuardianNetworkService} = require('../src/services/GuardianNetworkService');

    const result = await GuardianNetworkService.sendSosToGuardians({
      location: {latitude: -8.05, longitude: -34.88},
      senderName: 'Paula',
      message: 'SOS active',
      guardians: [{name: 'Ana', phone: '(11) 99999-9999'}],
    });

    expect(result).toEqual({
      ok: false,
      accepted: true,
      delivered: false,
      requestId: 'render-direct-req-2',
      jobId: undefined,
      reason: 'backend_accepted_without_fanout',
    });
  });
});
