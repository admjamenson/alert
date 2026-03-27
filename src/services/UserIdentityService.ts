import AsyncStorage from '@react-native-async-storage/async-storage';
import DeviceInfo from 'react-native-device-info';

const DEVICE_ID_KEY = '@Alert:DeviceId';
const PHONE_KEY = '@Alert:UserPhone';

const normalizePhone = (phone?: string | null) => {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  return digits.length > 0 ? `+${digits}` : '';
};

export const UserIdentityService = {
  normalizePhone,

  async getDeviceId(): Promise<string> {
    try {
      const stored = await AsyncStorage.getItem(DEVICE_ID_KEY);
      if (stored) return stored;
      const unique = await DeviceInfo.getUniqueId();
      const id = unique || `device-${Date.now()}`;
      await AsyncStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch {
      return `device-${Date.now()}`;
    }
  },

  async setUserPhone(phone: string): Promise<void> {
    try {
      const normalized = normalizePhone(phone);
      if (normalized) {
        await AsyncStorage.setItem(PHONE_KEY, normalized);
      }
    } catch {
      // ignore
    }
  },

  async getUserPhone(): Promise<string> {
    try {
      const stored = await AsyncStorage.getItem(PHONE_KEY);
      return stored || '';
    } catch {
      return '';
    }
  },
};
