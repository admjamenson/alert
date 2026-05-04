import { GetEpidemicFeedQuery } from './GetEpidemicFeedQuery';
import { EpidemicMode, EpidemicSnapshot, EpidemicWindow } from '../../services/EpidemicService';

export const GetEpidemicMapSnapshotQuery = {
  async execute(params: {
    latitude: number | null;
    longitude: number | null;
    mode: EpidemicMode;
    window: EpidemicWindow;
    force?: boolean;
  }): Promise<EpidemicSnapshot | null> {
    if (
      typeof params.latitude !== 'number' ||
      !Number.isFinite(params.latitude) ||
      typeof params.longitude !== 'number' ||
      !Number.isFinite(params.longitude)
    ) {
      return null;
    }

    return GetEpidemicFeedQuery.execute({
      latitude: params.latitude,
      longitude: params.longitude,
      mode: params.mode,
      window: params.window,
      force: params.force,
    });
  },
};
