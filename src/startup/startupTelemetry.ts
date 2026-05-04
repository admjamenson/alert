export type StartupPhase =
  | 'APP_START_BEGIN'
  | 'CRITICAL_SHELL_MOUNT_BEGIN'
  | 'CRITICAL_SHELL_FIRST_FRAME'
  | 'SOS_READY'
  | 'SOS_TAP'
  | 'SOS_DISPATCH_BEGIN'
  | 'SOS_DISPATCH_SETTLED'
  | 'DEFERRED_BOOT_BEGIN'
  | 'MAIN_APP_READY';

type StartupGlobal = typeof globalThis & {
  __ALERT_JS_ENTRY_TS__?: number;
  __ALERT_STARTUP_MARKS__?: Partial<Record<StartupPhase, number>>;
};

const getMarks = () => {
  const runtime = globalThis as StartupGlobal;
  if (!runtime.__ALERT_STARTUP_MARKS__) {
    runtime.__ALERT_STARTUP_MARKS__ = {
      APP_START_BEGIN: runtime.__ALERT_JS_ENTRY_TS__ || Date.now(),
    };
  }
  return runtime.__ALERT_STARTUP_MARKS__;
};

export const markStartupPhase = (
  phase: StartupPhase,
  options: { overwrite?: boolean } = {},
): number => {
  const marks = getMarks();
  if (!options.overwrite && typeof marks[phase] === 'number') {
    return Number(marks[phase]);
  }

  const ts = Date.now();
  marks[phase] = ts;
  const start = marks.APP_START_BEGIN || ts;
  const delta = ts - start;
  console.info(`[ALERT-STARTUP] ${phase} +${delta}ms`);
  setTimeout(() => {
    try {
      const { recordOperationalMetric } = require('../observability/OperationalMetrics');
      recordOperationalMetric('startup_phase_ms', delta, { phase });
    } catch {
      // Startup markers must stay best-effort.
    }
  }, 0);
  return ts;
};

export const getStartupDelta = (phase: StartupPhase): number | null => {
  const marks = getMarks();
  const start = marks.APP_START_BEGIN;
  const ts = marks[phase];
  if (typeof start !== 'number' || typeof ts !== 'number') {
    return null;
  }
  return ts - start;
};

export const getStartupSnapshot = (): Record<string, number> => {
  const marks = getMarks();
  const start = marks.APP_START_BEGIN || Date.now();
  return Object.entries(marks).reduce<Record<string, number>>(
    (acc, [key, value]) => {
      if (typeof value === 'number') {
        acc[key] = value - start;
      }
      return acc;
    },
    {},
  );
};
