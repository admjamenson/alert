jest.mock('../src/i18n', () => ({
  __esModule: true,
  default: {
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'sos_in_app_message_body') {
        return `SOS active. My location: ${params?.location}. Open map: ${params?.mapUrl}`;
      }
      if (key === 'guardian_label') {
        return 'Guardian';
      }
      if (key === 'guardians_conversation_title') {
        return 'Guardians';
      }
      return key;
    },
  },
}));

jest.mock('../src/services/KyberNetworkService', () => ({
  KyberNetworkService: {
    broadcastEmergency: jest.fn(),
    getCapabilityStatus: jest.fn(() => ({
      secureDispatch: true,
      offlineQueue: true,
      integrityProtection: true,
    })),
  },
}));

jest.mock('../src/services/GuardianNetworkService', () => ({
  GuardianNetworkService: {
    sendSosToGuardians: jest.fn(),
  },
}));

jest.mock('../src/services/ProfileService', () => ({
  ProfileService: {
    getProfile: jest.fn(async () => ({name: 'Paula'})),
  },
}));

jest.mock('../src/services/RiskReportService', () => ({
  RiskReportService: {
    addSosActivation: jest.fn(),
  },
}));

jest.mock('../src/services/ChatThreadService', () => ({
  ChatThreadService: {
    getCurrentChatUser: jest.fn(async () => ({id: 'me'})),
    sendMessage: jest.fn(),
  },
}));

describe('SosDispatchService', () => {
  beforeEach(async () => {
    jest.resetModules();
    jest.clearAllMocks();
    const AsyncStorage = require('@react-native-async-storage/async-storage');
    await AsyncStorage.clear();
  });

  it('uses Crystals-Kybes in the main SOS flow and treats queued relay as accepted', async () => {
    const {KyberNetworkService} = require('../src/services/KyberNetworkService');
    const {GuardianNetworkService} = require('../src/services/GuardianNetworkService');
    const {ChatThreadService} = require('../src/services/ChatThreadService');
    KyberNetworkService.broadcastEmergency.mockResolvedValue({
      accepted: true,
      delivered: false,
      queued: true,
      integrityProtected: true,
    });
    GuardianNetworkService.sendSosToGuardians.mockResolvedValue({ok: false});
    ChatThreadService.sendMessage.mockRejectedValue(new Error('chat offline'));

    const {SosDispatchService} = require('../src/services/SosDispatchService');
    const result = await SosDispatchService.dispatchFromApp({
      location: {latitude: -8.05, longitude: -34.88},
      locationName: 'Recife',
      senderName: 'Paula',
      guardians: [{remoteId: 'guardian-1', name: 'Ana'}],
    });

    expect(KyberNetworkService.broadcastEmergency).toHaveBeenCalledWith(
      {latitude: -8.05, longitude: -34.88},
      [{id: 'guardian-1', name: 'Ana', channel: 'guardian'}],
      'Paula',
    );
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        delivered: false,
        queued: true,
        viaKyber: true,
        viaGuardians: false,
        viaConversation: false,
        integrityProtected: true,
      }),
    );
  });

  it('prefers direct guardians delivery and skips relay when the guardian path succeeds', async () => {
    const {KyberNetworkService} = require('../src/services/KyberNetworkService');
    const {GuardianNetworkService} = require('../src/services/GuardianNetworkService');
    const {ChatThreadService} = require('../src/services/ChatThreadService');
    GuardianNetworkService.sendSosToGuardians.mockResolvedValue({
      ok: true,
      accepted: true,
      delivered: true,
      requestId: 'direct-req-1',
      jobId: 'sos-job-1',
    });
    ChatThreadService.sendMessage.mockRejectedValue(new Error('chat offline'));

    const {SosDispatchService} = require('../src/services/SosDispatchService');
    const result = await SosDispatchService.dispatchFromApp({
      location: {latitude: -8.05, longitude: -34.88},
      locationName: 'Recife',
      senderName: 'Paula',
      guardians: [{name: 'Ana', phone: '(11) 99999-9999'}],
    });

    expect(GuardianNetworkService.sendSosToGuardians).toHaveBeenCalledWith(
      expect.objectContaining({
        guardians: [{name: 'Ana', phone: '+11999999999'}],
      }),
    );
    expect(KyberNetworkService.broadcastEmergency).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        delivered: true,
        queued: false,
        viaKyber: false,
        viaGuardians: true,
      }),
    );
  });

  it('falls back to relay when guardian backend accepts but no fanout is available', async () => {
    const {KyberNetworkService} = require('../src/services/KyberNetworkService');
    const {GuardianNetworkService} = require('../src/services/GuardianNetworkService');
    const {ChatThreadService} = require('../src/services/ChatThreadService');
    GuardianNetworkService.sendSosToGuardians.mockResolvedValue({
      ok: false,
      accepted: true,
      delivered: false,
      requestId: 'direct-req-2',
      reason: 'backend_accepted_without_fanout',
    });
    KyberNetworkService.broadcastEmergency.mockResolvedValue({
      accepted: true,
      delivered: true,
      queued: false,
      integrityProtected: true,
    });
    ChatThreadService.sendMessage.mockRejectedValue(new Error('chat offline'));

    const {SosDispatchService} = require('../src/services/SosDispatchService');
    const result = await SosDispatchService.dispatchFromApp({
      location: {latitude: -8.05, longitude: -34.88},
      locationName: 'Recife',
      senderName: 'Paula',
      guardians: [{name: 'Ana', phone: '(11) 99999-9999'}],
    });

    expect(KyberNetworkService.broadcastEmergency).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        accepted: true,
        delivered: true,
        queued: false,
        viaKyber: true,
        viaGuardians: false,
      }),
    );
  });
});
