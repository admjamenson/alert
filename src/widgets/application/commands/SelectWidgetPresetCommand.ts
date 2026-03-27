import { WidgetPreset } from '../../domain/WidgetPreset';
import { widgetBridge } from '../../infra/WidgetBridge';
import { widgetSnapshotRepository } from '../../infra/WidgetSnapshotRepository';

type SelectWidgetPresetInput = {
  preset: WidgetPreset;
  widgetInstanceId?: number;
};

export const SelectWidgetPresetCommand = {
  async execute(input: SelectWidgetPresetInput): Promise<void> {
    if (typeof input.widgetInstanceId === 'number' && Number.isFinite(input.widgetInstanceId)) {
      const instanceId = Math.trunc(input.widgetInstanceId);
      await widgetSnapshotRepository.setPresetForInstance(instanceId, input.preset);
      await widgetBridge.setWidgetPreset(instanceId, input.preset);
      return;
    }
    await widgetSnapshotRepository.setDefaultPreset(input.preset);
    await widgetBridge.setDefaultPreset(input.preset);
  },
};
