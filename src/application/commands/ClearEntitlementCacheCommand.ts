import { EntitlementService } from '../../services/EntitlementService';

export const ClearEntitlementCacheCommand = {
  async execute(): Promise<void> {
    await EntitlementService.clearCache();
  },
};

