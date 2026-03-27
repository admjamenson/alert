import { WidgetSnapshot } from './WidgetSnapshot';

const hasValue = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0;

const isFiniteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value);

export const isWidgetSnapshotValid = (snapshot: WidgetSnapshot): boolean => {
  if (!snapshot) return false;
  if (!hasValue(snapshot.updatedAt)) return false;
  if (!hasValue(snapshot.deeplink)) return false;
  if (!String(snapshot.deeplink).startsWith('alertapp://')) return false;
  if (!hasValue(snapshot.title)) return false;
  if (!hasValue(snapshot.subtitle)) return false;
  if (!snapshot.confidence) return false;
  if (snapshot.visual?.level != null) {
    if (!isFiniteNumber(snapshot.visual.level)) return false;
    if ((snapshot.visual.level as number) < 0 || (snapshot.visual.level as number) > 100) {
      return false;
    }
  }
  if (snapshot.visual?.segmentProfile != null) {
    if (!Array.isArray(snapshot.visual.segmentProfile)) return false;
    if (snapshot.visual.segmentProfile.some(value => !isFiniteNumber(value))) return false;
  }
  return true;
};
