import AsyncStorage from '@react-native-async-storage/async-storage';
import { KyberNetworkService } from './KyberNetworkService';
import { ProfileService } from './ProfileService';
import { GuardianNetworkService } from './GuardianNetworkService';
import { RiskReportService } from './RiskReportService';

const LAST_LOCATION_KEY = '@Alert:LastLocation';

const loadLastLocation = async (): Promise<{
  latitude: number;
  longitude: number;
} | null> => {
  try {
    const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.latitude === 'number' &&
      typeof parsed?.longitude === 'number'
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
};

export const SosDispatchService = {
  async dispatchFromQuickAction(): Promise<boolean> {
    const location = await loadLastLocation();
    if (!location) return false;

    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(location, 'quick_action');

    const profile = await ProfileService.getProfile();
    const storedContacts = await AsyncStorage.getItem('@emergency_contacts');
    const contacts = storedContacts ? JSON.parse(storedContacts) : [];

    const ok = await KyberNetworkService.broadcastEmergency(
      location,
      contacts,
      profile.name,
    );

    const guardiansRaw = await AsyncStorage.getItem('@guardians_list');
    const guardians = guardiansRaw ? JSON.parse(guardiansRaw) : [];
    await GuardianNetworkService.sendSosToGuardians({
      location,
      senderName: profile.name,
      guardians,
    });

    return ok;
  },

  async dispatchFromApp(payload: {
    location: { latitude: number; longitude: number };
    contacts: any[];
    senderName?: string;
    guardians: Array<{ remoteId?: string; name: string }>;
  }): Promise<boolean> {
    // Record a local "violence index" report so the risk map can highlight this area.
    void RiskReportService.addSosActivation(payload.location, 'self');

    const ok = await KyberNetworkService.broadcastEmergency(
      payload.location,
      payload.contacts,
      payload.senderName,
    );
    await GuardianNetworkService.sendSosToGuardians({
      location: payload.location,
      senderName: payload.senderName,
      guardians: payload.guardians,
    });
    return ok;
  },
};
