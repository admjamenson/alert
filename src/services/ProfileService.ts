import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_KEY = '@Alert:Profile';

export type ProfileData = {
  name: string;
  avatarUri?: string;
};

export const ProfileService = {
  async getProfile(): Promise<ProfileData> {
    try {
      const raw = await AsyncStorage.getItem(PROFILE_KEY);
      if (!raw) return { name: '' };
      return JSON.parse(raw) as ProfileData;
    } catch {
      return { name: '' };
    }
  },

  async saveProfile(profile: ProfileData): Promise<void> {
    try {
      await AsyncStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      // ignore
    }
  },
};
