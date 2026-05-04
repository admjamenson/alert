import { markStartupPhase } from './startupTelemetry';

type DeferredHandle = {
  cancel: () => void;
};

export const scheduleDeferredBootstrap = (
  onBootstrap: () => void,
): DeferredHandle => {
  let cancelled = false;
  let firstFrameId: number | null = null;
  let secondFrameId: number | null = null;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const runtimeDelay =
    Number((globalThis as { __ALERT_DEFERRED_BOOT_DELAY_MS__?: unknown })
      .__ALERT_DEFERRED_BOOT_DELAY_MS__) || 80;
  const delayMs = Math.max(0, Math.min(500, runtimeDelay));

  firstFrameId = requestAnimationFrame(() => {
    secondFrameId = requestAnimationFrame(() => {
      timerId = setTimeout(() => {
        if (cancelled) return;
        markStartupPhase('DEFERRED_BOOT_BEGIN');
        onBootstrap();
      }, delayMs);
    });
  });

  return {
    cancel: () => {
      cancelled = true;
      if (firstFrameId !== null) {
        cancelAnimationFrame(firstFrameId);
      }
      if (secondFrameId !== null) {
        cancelAnimationFrame(secondFrameId);
      }
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    },
  };
};
