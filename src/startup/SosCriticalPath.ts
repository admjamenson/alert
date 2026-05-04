import { markStartupPhase } from './startupTelemetry';

export type CriticalSosOutcome =
  | 'accepted'
  | 'queued'
  | 'not_configured'
  | 'failed';

type SosDispatchResultLike = {
  accepted?: boolean;
  delivered?: boolean;
  queued?: boolean;
};

const isSosDispatchResultLike = (
  value: unknown,
): value is SosDispatchResultLike =>
  value !== null && typeof value === 'object';

export const triggerCriticalHaptic = (
  kind: 'press' | 'success' | 'error' = 'press',
): void => {
  try {
    const moduleRef = require('react-native-haptic-feedback');
    const haptic = moduleRef.default || moduleRef;
    const method =
      kind === 'success'
        ? 'notificationSuccess'
        : kind === 'error'
          ? 'notificationError'
          : 'impactHeavy';
    haptic.trigger(method);
  } catch {
    // Haptics must never block SOS.
  }
};

export const triggerCriticalSos = async (): Promise<CriticalSosOutcome> => {
  markStartupPhase('SOS_DISPATCH_BEGIN', { overwrite: true });

  try {
    const moduleRef = require('../services/SosDispatchService');
    const result = await moduleRef.SosDispatchService.dispatchFromQuickAction();
    markStartupPhase('SOS_DISPATCH_SETTLED', { overwrite: true });

    if (!isSosDispatchResultLike(result) || !result.accepted) {
      triggerCriticalHaptic('error');
      return 'not_configured';
    }

    triggerCriticalHaptic(result.delivered || result.queued ? 'success' : 'press');
    return result.queued && !result.delivered ? 'queued' : 'accepted';
  } catch {
    markStartupPhase('SOS_DISPATCH_SETTLED', { overwrite: true });
    triggerCriticalHaptic('error');
    return 'failed';
  }
};
