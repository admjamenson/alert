import { AlertSignal, AlertIntelligenceContext } from '../../types/alertIntelligence';

export type SourcePolicy = {
  id: string;
  ttlMs?: number;
  maxSignals?: number;
  allowHttp?: boolean;
  allowedDomains?: string[];
  mode?: 'metadata_only' | 'full' | string;
};

export type AlertSignalsConnector = {
  id: string;
  supportsCategory?: (category?: string | null) => boolean;
  fetchSignals: (context: AlertIntelligenceContext) => Promise<AlertSignal[]>;
  policy?: SourcePolicy;
};
