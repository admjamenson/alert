jest.mock('../src/services/MonitoringService', () => ({
  MonitoringService: {
    getActiveEvents: jest.fn(),
  },
}));

jest.mock('../src/services/NotificationService', () => ({
  NotificationService: {
    getActiveSos: jest.fn(),
  },
}));

jest.mock('../src/services/RouteDestinationService', () => ({
  RouteDestinationService: {
    getDefaultDestination: jest.fn(),
  },
}));

jest.mock('../src/application/queries/GetEpidemicFeedQuery', () => ({
  GetEpidemicFeedQuery: {
    execute: jest.fn(),
  },
}));

jest.mock('../src/application/queries/GetOperationalSnapshotQuery', () => ({
  GetOperationalSnapshotQuery: {
    execute: jest.fn(),
  },
}));

jest.mock('../src/application/queries/GetAlertBrainBriefingQuery', () => ({
  GetAlertBrainBriefingQuery: {
    execute: jest.fn(),
  },
  createOperationalFallbackBriefing: jest.fn(),
}));

jest.mock('../src/services/ImportantAlertsService', () => ({
  ImportantAlertsService: {
    ingestAlerts: jest.fn(),
  },
}));

import {GetHomeRiskSnapshotQuery} from '../src/application/queries/GetHomeRiskSnapshotQuery';
import {MonitoringService} from '../src/services/MonitoringService';
import {NotificationService} from '../src/services/NotificationService';
import {RouteDestinationService} from '../src/services/RouteDestinationService';
import {GetEpidemicFeedQuery} from '../src/application/queries/GetEpidemicFeedQuery';
import {GetOperationalSnapshotQuery} from '../src/application/queries/GetOperationalSnapshotQuery';
import {
  GetAlertBrainBriefingQuery,
  createOperationalFallbackBriefing,
} from '../src/application/queries/GetAlertBrainBriefingQuery';
import {ImportantAlertsService} from '../src/services/ImportantAlertsService';

describe('GetHomeRiskSnapshotQuery', () => {
  const operational = {
    snapshot: null,
    state: 'stale' as const,
    stale: true,
    errorCode: 'cached_snapshot',
  };

  const fallbackBriefing = {
    state: 'stale' as const,
    stale: true,
    headline: '',
    summary: '',
    action: '',
    bullets: [],
    signalCount: 0,
    severeSignalCount: 0,
    sourceCount: 0,
    trustStatus: 'stale' as const,
    sources: [],
    conflict: false,
    operational,
    errorCode: 'cached_snapshot',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (MonitoringService.getActiveEvents as jest.Mock).mockResolvedValue({
      alerts: [],
      activeIds: new Set<string>(),
      unavailableIds: new Set<string>(),
    });
    (NotificationService.getActiveSos as jest.Mock).mockResolvedValue(null);
    (RouteDestinationService.getDefaultDestination as jest.Mock).mockResolvedValue(
      null,
    );
    (GetEpidemicFeedQuery.execute as jest.Mock).mockResolvedValue(null);
    (GetOperationalSnapshotQuery.execute as jest.Mock).mockResolvedValue(
      operational,
    );
    (
      createOperationalFallbackBriefing as jest.Mock
    ).mockReturnValue(fallbackBriefing);
    (GetAlertBrainBriefingQuery.execute as jest.Mock).mockResolvedValue({
      ...fallbackBriefing,
      state: 'fresh',
      stale: false,
      trustStatus: 'online',
    });
    (ImportantAlertsService.ingestAlerts as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  it('keeps the initial home snapshot on the critical path without waiting for the briefing', async () => {
    const result = await GetHomeRiskSnapshotQuery.execute({
      latitude: -23.55,
      longitude: -46.63,
      riskScore: 0.2,
      clientRiskLevel: 'low',
      locale: 'pt-BR',
      includeBriefing: false,
      t: (key: string) => key,
    });

    expect(createOperationalFallbackBriefing).toHaveBeenCalledWith(
      operational,
      'cached_snapshot',
    );
    expect(GetAlertBrainBriefingQuery.execute).not.toHaveBeenCalled();
    expect(result.briefing).toBe(fallbackBriefing);
    expect(result.operational).toBe(operational);
  });

  it('reuses the operational snapshot when the enriched briefing is requested', async () => {
    await GetHomeRiskSnapshotQuery.execute({
      latitude: 40.71,
      longitude: -74.0,
      riskScore: 0.55,
      clientRiskLevel: 'medium',
      locale: 'en-US',
      includeBriefing: true,
      t: (key: string) => key,
    });

    expect(GetAlertBrainBriefingQuery.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 40.71,
        longitude: -74,
        locale: 'en-US',
        operational,
      }),
    );
  });
});
