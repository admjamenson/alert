import {
  MonitoringContinuityStore,
  type ContinuityScope,
  type ContinuitySourceOfficiality,
  type ContinuityTrustStatus,
} from '../../services/MonitoringContinuityStore';

export const GetMonitoringFeedContinuitySnapshotQuery = {
  async read(params: {
    eventType: string;
    scope: ContinuityScope;
    latitude?: number | null;
    longitude?: number | null;
  }) {
    return MonitoringContinuityStore.readSnapshot({
      eventType: params.eventType,
      scope: params.scope,
      latitude: params.latitude,
      longitude: params.longitude,
    });
  },

  async save(params: {
    eventType: string;
    scope: ContinuityScope;
    latitude?: number | null;
    longitude?: number | null;
    status: 'active' | 'none' | 'unavailable' | 'loading';
    trustStatus: ContinuityTrustStatus;
    summary: string;
    aiSummary?: string;
    aiConflict?: boolean;
    evidenceLinks?: string[];
    sourceLine: string;
    sourceTrustTier?: 'A' | 'B' | 'C' | '';
    sourceUrl?: string;
    sources: Array<{
      name: string;
      url?: string | null;
      officiality: ContinuitySourceOfficiality;
    }>;
    sourcesFallback: boolean;
    updatedAt?: string;
    aiSignals: any[];
    officialPoints: any;
    sosPoints: any;
    windPanels?: any;
    pandemicTop3?: any;
  }) {
    return MonitoringContinuityStore.saveSnapshot({
      eventType: params.eventType,
      scope: params.scope,
      latitude: params.latitude,
      longitude: params.longitude,
      status: params.status,
      trustStatus: params.trustStatus,
      summary: params.summary,
      aiSummary: params.aiSummary,
      aiConflict: params.aiConflict,
      evidenceLinks: params.evidenceLinks,
      sourceLine: params.sourceLine,
      sourceTrustTier: params.sourceTrustTier || '',
      sourceUrl: params.sourceUrl,
      sources: params.sources.map(source => ({
        name: source.name,
        url: source.url || undefined,
        officiality: source.officiality,
      })),
      sourcesFallback: params.sourcesFallback,
      updatedAt: params.updatedAt,
      aiSignals: params.aiSignals,
      officialPoints: params.officialPoints,
      sosPoints: params.sosPoints,
      windPanels: params.windPanels,
      pandemicTop3: params.pandemicTop3,
    });
  },
};
