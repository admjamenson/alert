import {
  OperationalSnapshotReadModel,
  normalizeOperationalSnapshot,
  isSnapshotStale,
} from '../../domain/trust/OperationalSnapshot';
import { operationalSnapshotApiAdapter } from '../../infrastructure/adapters/OperationalSnapshotApiAdapter';

type ExecuteParams = {
  latitude?: number | null;
  longitude?: number | null;
  radiusKm?: number;
  force?: boolean;
};

const inFlightByKey = new Map<string, Promise<OperationalSnapshotReadModel>>();

const toKey = (params: ExecuteParams) => {
  const lat = Number(params.latitude || 0).toFixed(2);
  const lon = Number(params.longitude || 0).toFixed(2);
  const radius = Number(params.radiusKm || 35).toFixed(0);
  return `${lat}:${lon}:${radius}`;
};

const isFiniteCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const staleReadModel = (errorCode: string): OperationalSnapshotReadModel => ({
  snapshot: null,
  state: 'error',
  stale: true,
  errorCode,
});

export const GetOperationalSnapshotQuery = {
  async execute(params: ExecuteParams): Promise<OperationalSnapshotReadModel> {
    if (!isFiniteCoord(params.latitude) || !isFiniteCoord(params.longitude)) {
      const cached = await operationalSnapshotApiAdapter.getCachedSnapshot();
      if (cached) {
        const normalized = normalizeOperationalSnapshot(cached);
        return {
          snapshot: normalized,
          state: isSnapshotStale(normalized) ? 'stale' : 'fresh',
          stale: isSnapshotStale(normalized),
          errorCode: 'location_unavailable',
        };
      }
      return staleReadModel('location_unavailable');
    }

    const latitude = Number(params.latitude);
    const longitude = Number(params.longitude);
    const key = toKey(params);
    if (!params.force && inFlightByKey.has(key)) {
      return inFlightByKey.get(key)!;
    }

    const task = (async (): Promise<OperationalSnapshotReadModel> => {
      try {
        const snapshot = await operationalSnapshotApiAdapter.getSnapshotByLocation({
          latitude,
          longitude,
          radiusKm: params.radiusKm,
          force: params.force,
        });
        const normalized = normalizeOperationalSnapshot(snapshot);
        const stale = isSnapshotStale(normalized);
        return {
          snapshot: normalized,
          state: stale ? 'stale' : 'fresh',
          stale,
        };
      } catch (error) {
        const cached = await operationalSnapshotApiAdapter.getCachedSnapshot();
        if (cached) {
          const normalized = normalizeOperationalSnapshot(cached);
          return {
            snapshot: normalized,
            state: 'stale',
            stale: true,
            errorCode:
              typeof (error as any)?.message === 'string' ? (error as any).message : 'snapshot_fetch_failed',
          };
        }
        return staleReadModel(
          typeof (error as any)?.message === 'string' ? (error as any).message : 'snapshot_fetch_failed',
        );
      }
    })().finally(() => {
      inFlightByKey.delete(key);
    });

    inFlightByKey.set(key, task);
    return task;
  },
};
