import { SosDispatchService } from '../services/SosDispatchService';

export const SOSQuickTask = async () => {
  try {
    await SosDispatchService.dispatchFromQuickAction();
  } catch {
    // ignore
  }
};

export default SOSQuickTask;
