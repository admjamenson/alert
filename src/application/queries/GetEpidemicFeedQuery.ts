import {
  EpidemicMode,
  EpidemicSnapshot,
  EpidemicWindow,
  EpidemicService,
} from '../../services/EpidemicService';

export const GetEpidemicFeedQuery = {
  async execute(params: {
    latitude: number;
    longitude: number;
    mode: EpidemicMode;
    window: EpidemicWindow;
    force?: boolean;
  }): Promise<EpidemicSnapshot> {
    return EpidemicService.getSnapshot(
      params.latitude,
      params.longitude,
      params.mode,
      params.window,
      { force: params.force },
    );
  },
};
