import { widgetBridge } from '../../infra/WidgetBridge';
import { widgetDataComposer } from '../../infra/WidgetDataComposer';
import { widgetSnapshotRepository } from '../../infra/WidgetSnapshotRepository';

let inFlight: Promise<void> | null = null;

export const RefreshWidgetSnapshotsCommand = {
  async execute(options?: { force?: boolean }): Promise<void> {
    if (!options?.force && inFlight) return inFlight;
    const task = (async () => {
      const snapshots = await widgetDataComposer.composeAll({ force: options?.force });
      await widgetSnapshotRepository.saveMany(snapshots);
      await widgetBridge.pushSnapshots(snapshots);
      await widgetBridge.reloadAll();
    })().finally(() => {
      if (inFlight === task) {
        inFlight = null;
      }
    });
    inFlight = task;
    return task;
  },
};
