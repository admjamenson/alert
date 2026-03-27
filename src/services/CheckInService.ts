import AsyncStorage from '@react-native-async-storage/async-storage';
import { GuardianNetworkService } from './GuardianNetworkService';
import { ProfileService } from './ProfileService';
import { WeatherService } from './WeatherService';
import { NotificationService } from './NotificationService';
import i18n from '../i18n';

const GUARDIANS_KEY = '@guardians_list';
const LAST_LOCATION_KEY = '@Alert:LastLocation';
const CHECKIN_NOTIFICATION_ENABLED = false;

type GuardianItem = { remoteId?: string; name: string };

const parseJson = <T,>(raw: string | null): T | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

const isValidCoord = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export const CheckInService = {
  async send(): Promise<{ ok: boolean; reason?: 'no_guardians' | 'error' }> {
    const guardiansRaw = await AsyncStorage.getItem(GUARDIANS_KEY);
    const guardiansList = parseJson<any[]>(guardiansRaw) || [];
    const guardians: GuardianItem[] = guardiansList
      .map(item => ({
        remoteId: typeof item?.remoteId === 'string' ? item.remoteId : undefined,
        name: typeof item?.name === 'string' ? item.name : i18n.t('guardian_label'),
      }))
      .filter(item => Boolean(item.remoteId));

    if (guardians.length === 0) return { ok: false, reason: 'no_guardians' };

    const profile = await ProfileService.getProfile();
    const senderName = profile.name || i18n.t('chat_sender_fallback');

    let city: string | undefined;
    const lastLocRaw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    const lastLoc = parseJson<{ latitude?: unknown; longitude?: unknown }>(lastLocRaw);
    const lat = Number(lastLoc?.latitude);
    const lon = Number(lastLoc?.longitude);
    if (isValidCoord(lat) && isValidCoord(lon)) {
      try {
        const weather = await WeatherService.getCurrentWeather(lat, lon);
        if (typeof weather?.city === 'string' && weather.city.trim() && weather.city.trim() !== '...') {
          city = weather.city.trim();
        }
      } catch {
        // ignore city errors
      }
    }

    const message = i18n.t('checkin_default_message');
    const result = await GuardianNetworkService.sendCheckInToGuardians({
      senderName,
      city,
      message,
      guardians,
    });

    if (result.ok) {
      if (CHECKIN_NOTIFICATION_ENABLED) {
        await NotificationService.add({
          id: `checkin-self-${Date.now()}`,
          type: 'system',
          title: i18n.t('checkin_notification_title'),
          summary: city ? `${message} - ${city}` : message,
          timestamp: new Date().toISOString(),
          sourceName: 'Alert',
          data: { kind: 'checkin', message, city },
        });
      }
      return { ok: true };
    }

    return { ok: false, reason: 'error' };
  },
};


