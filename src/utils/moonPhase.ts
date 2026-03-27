export type MoonPhase =
  | 'NEW'
  | 'WAXING_CRESCENT'
  | 'FIRST_QUARTER'
  | 'WAXING_GIBBOUS'
  | 'FULL'
  | 'WANING_GIBBOUS'
  | 'LAST_QUARTER'
  | 'WANING_CRESCENT';

export type Hemisphere = 'north' | 'south';

type MoonPhaseResult = {
  phase: MoonPhase;
  illumination: number;
  angle: number;
};

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC_MS = Date.UTC(2000, 0, 6, 18, 14, 0);
const PHASE_SEQUENCE: MoonPhase[] = [
  'NEW',
  'WAXING_CRESCENT',
  'FIRST_QUARTER',
  'WAXING_GIBBOUS',
  'FULL',
  'WANING_GIBBOUS',
  'LAST_QUARTER',
  'WANING_CRESCENT',
];

const normalizeCycleFraction = (value: number): number => {
  const normalized = value % 1;
  return normalized < 0 ? normalized + 1 : normalized;
};

export const getMoonPhase = (date: Date): MoonPhaseResult => {
  const timestamp = Number.isFinite(date?.getTime?.()) ? date.getTime() : Date.now();
  const elapsedDays = (timestamp - KNOWN_NEW_MOON_UTC_MS) / 86_400_000;
  const cycleFraction = normalizeCycleFraction(elapsedDays / SYNODIC_MONTH_DAYS);
  const phaseIndex = Math.floor(cycleFraction * 8 + 0.5) % 8;
  const illumination = 0.5 * (1 - Math.cos(2 * Math.PI * cycleFraction));
  const angle = cycleFraction * 360;

  return {
    phase: PHASE_SEQUENCE[phaseIndex],
    illumination,
    angle,
  };
};

export const inferHemisphere = (latitude?: number | null): Hemisphere => {
  if (typeof latitude === 'number' && Number.isFinite(latitude)) {
    return latitude < 0 ? 'south' : 'north';
  }
  return 'south';
};

export const isWaxingMoonPhase = (phase: MoonPhase): boolean =>
  phase === 'WAXING_CRESCENT' || phase === 'FIRST_QUARTER' || phase === 'WAXING_GIBBOUS';

export const moonPhaseLabelKey = (phase: MoonPhase): string => {
  switch (phase) {
    case 'NEW':
      return 'moon_phase_new';
    case 'WAXING_CRESCENT':
      return 'moon_phase_waxing_crescent';
    case 'FIRST_QUARTER':
      return 'moon_phase_first_quarter';
    case 'WAXING_GIBBOUS':
      return 'moon_phase_waxing_gibbous';
    case 'FULL':
      return 'moon_phase_full';
    case 'WANING_GIBBOUS':
      return 'moon_phase_waning_gibbous';
    case 'LAST_QUARTER':
      return 'moon_phase_last_quarter';
    case 'WANING_CRESCENT':
    default:
      return 'moon_phase_waning_crescent';
  }
};
