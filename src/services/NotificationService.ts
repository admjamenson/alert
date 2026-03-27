import AsyncStorage from '@react-native-async-storage/async-storage';
import { AlertNotification, SosPayload, GuardianRequestPayload } from '../types/notifications';
import i18n from '../i18n';
import { RiskReportService } from './RiskReportService';

const NOTIF_KEY = '@Alert:Notifications';
const ACTIVE_SOS_KEY = '@Alert:ActiveSos';
const SEEN_AT_KEY = '@Alert:NotificationsSeenAt';

const parseList = (raw: string | null): AlertNotification[] => {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as AlertNotification[];
  } catch {
    return [];
  }
};

const isDisabledCheckInNotification = (item: AlertNotification): boolean => {
  const id = String(item?.id || '').toLowerCase();
  const title = String(item?.title || '').toLowerCase();
  const data = (item?.data || {}) as Record<string, any>;
  const kind = String(data?.kind || '').toLowerCase();

  return (
    id.startsWith('daily-briefing-') ||
    kind === 'checkin' ||
    title.includes('check-in de segurança') ||
    title.startsWith('check-in:')
  );
};

const stripDisabledCheckInNotifications = (items: AlertNotification[]): AlertNotification[] =>
  items.filter(item => !isDisabledCheckInNotification(item));

type SeedHazard = {
  id: string;
  titleKey: string;
  summaryKey: string;
  sourceName: string;
  sourceUrl: string;
};

const SEED_HAZARDS: SeedHazard[] = [
  {
    id: 'hazard-1',
    titleKey: 'notification_seed_hazard_1_title',
    summaryKey: 'notification_seed_hazard_1_summary',
    sourceName: 'INMET',
    sourceUrl: 'https://www.inmet.gov.br/',
  },
  {
    id: 'hazard-2',
    titleKey: 'notification_seed_hazard_2_title',
    summaryKey: 'notification_seed_hazard_2_summary',
    sourceName: 'Defesa Civil',
    sourceUrl: 'https://www.gov.br/defesacivil/',
  },
  {
    id: 'hazard-3',
    titleKey: 'notification_seed_hazard_3_title',
    summaryKey: 'notification_seed_hazard_3_summary',
    sourceName: 'USGS',
    sourceUrl: 'https://earthquake.usgs.gov/',
  },
  {
    id: 'hazard-4',
    titleKey: 'notification_seed_hazard_4_title',
    summaryKey: 'notification_seed_hazard_4_summary',
    sourceName: 'Defesa Civil',
    sourceUrl: 'https://www.gov.br/defesacivil/',
  },
  {
    id: 'hazard-5',
    titleKey: 'notification_seed_hazard_5_title',
    summaryKey: 'notification_seed_hazard_5_summary',
    sourceName: 'CEMADEN',
    sourceUrl: 'https://www.gov.br/cemaden/',
  },
  {
    id: 'hazard-6',
    titleKey: 'notification_seed_hazard_6_title',
    summaryKey: 'notification_seed_hazard_6_summary',
    sourceName: 'INMET',
    sourceUrl: 'https://www.inmet.gov.br/',
  },
  {
    id: 'hazard-7',
    titleKey: 'notification_seed_hazard_7_title',
    summaryKey: 'notification_seed_hazard_7_summary',
    sourceName: 'NOAA',
    sourceUrl: 'https://www.noaa.gov/',
  },
  {
    id: 'hazard-8',
    titleKey: 'notification_seed_hazard_8_title',
    summaryKey: 'notification_seed_hazard_8_summary',
    sourceName: 'UNESCO IOC',
    sourceUrl: 'https://ioc.unesco.org/',
  },
];

export const NotificationService = {
  async getAll(): Promise<AlertNotification[]> {
    const raw = await AsyncStorage.getItem(NOTIF_KEY);
    const list = parseList(raw);
    const sanitized = stripDisabledCheckInNotifications(list);
    if (sanitized.length !== list.length) {
      await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(sanitized));
    }
    return sanitized;
  },

  async getById(id: string): Promise<AlertNotification | undefined> {
    const list = await this.getAll();
    return list.find(n => n.id === id);
  },

  async add(notification: AlertNotification): Promise<void> {
    if (isDisabledCheckInNotification(notification)) {
      return;
    }
    const list = await this.getAll();
    const deduped = list.filter(item => item.id !== notification.id);
    const next = [notification, ...deduped].slice(0, 80);
    await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));

    if (notification.type === 'sos') {
      const payload = notification.data as SosPayload | undefined;
      void RiskReportService.addSosActivation(payload?.location, 'guardian');
    }
  },

  async remove(id: string): Promise<void> {
    const list = await this.getAll();
    const next = list.filter(item => item.id !== id);
    await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  },

  async addGuardianRequest(payload: GuardianRequestPayload): Promise<void> {
    const requesterName = payload.requesterName || i18n.t('guardian_generic');
    await this.add({
      id: `guardian-req-${Date.now()}`,
      type: 'guardian_request',
      title: i18n.t('notification_guardian_invite_title'),
      summary: i18n.t('notification_guardian_invite_summary', { name: requesterName }),
      timestamp: new Date().toISOString(),
      data: payload,
    });
  },

  async seedIfEmpty(): Promise<void> {
    // Avoid seeding demo data in release builds.
    if (!__DEV__) return;

    const list = await this.getAll();
    if (list.length > 0) return;

    const now = new Date().toISOString();

    const seedGuardianName = i18n.t('notification_seed_guardian_name');
    const seedSosSenderName = i18n.t('notification_seed_sos_sender_name');

    const hazardSeed: AlertNotification[] = SEED_HAZARDS.map(item => ({
      id: item.id,
      type: 'hazard',
      title: i18n.t(item.titleKey),
      summary: i18n.t(item.summaryKey),
      timestamp: now,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
    }));

    const seed: AlertNotification[] = [
      ...hazardSeed,
      {
        id: 'guardian-req-1',
        type: 'guardian_request',
        title: i18n.t('notification_guardian_invite_title'),
        summary: i18n.t('notification_guardian_invite_summary', {
          name: seedGuardianName,
        }),
        timestamp: now,
        data: {
          requesterName: seedGuardianName,
        } as GuardianRequestPayload,
      },
      {
        id: 'sos-1',
        type: 'sos',
        title: i18n.t('sos_from_guardian'),
        summary: i18n.t('guardian_requested_help', {
          name: seedSosSenderName,
        }),
        timestamp: now,
        data: {
          senderName: seedSosSenderName,
          location: { latitude: -23.5567, longitude: -46.6358 },
          message: i18n.t('notification_seed_sos_message'),
        } as SosPayload,
      },
    ];

    await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(seed));
  },

  async markAllSeen(): Promise<void> {
    await AsyncStorage.setItem(SEEN_AT_KEY, String(Date.now()));
  },

  async getUnreadCount(): Promise<number> {
    const [list, seenRaw] = await Promise.all([
      this.getAll(),
      AsyncStorage.getItem(SEEN_AT_KEY),
    ]);
    const seenAt = seenRaw ? Number(seenRaw) : 0;
    if (!Number.isFinite(seenAt) || seenAt <= 0) return list.length;

    return list.filter(item => {
      const ts = Date.parse(item.timestamp);
      return Number.isFinite(ts) && ts > seenAt;
    }).length;
  },

  async ensureDailyBriefing(): Promise<boolean> {
    // Disabled by product decision: "Check-in de segurança" must not be shown automatically.
    await this.cleanupDisabledCheckInNotifications();
    return false;
  },

  async cleanupDisabledCheckInNotifications(): Promise<void> {
    const raw = await AsyncStorage.getItem(NOTIF_KEY);
    const list = parseList(raw);
    const next = stripDisabledCheckInNotifications(list);
    if (next.length === list.length) return;
    await AsyncStorage.setItem(NOTIF_KEY, JSON.stringify(next));
  },

  async setActiveSos(payload: SosPayload): Promise<void> {
    await AsyncStorage.setItem(ACTIVE_SOS_KEY, JSON.stringify(payload));
  },

  async getActiveSos(): Promise<SosPayload | null> {
    const raw = await AsyncStorage.getItem(ACTIVE_SOS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SosPayload;
    } catch {
      return null;
    }
  },

  async clearActiveSos(): Promise<void> {
    await AsyncStorage.removeItem(ACTIVE_SOS_KEY);
  },
};
