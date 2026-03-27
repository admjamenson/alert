import { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import i18n from '../i18n';
import { NotificationService } from './NotificationService';
import { ImportantAlertsService } from './ImportantAlertsService';

type RemoteMessage = FirebaseMessagingTypes.RemoteMessage;
type IncomingNotificationType = 'guardian_request' | 'sos' | 'checkin' | 'system';

const parseIncomingType = (value: string | object | undefined): IncomingNotificationType => {
  if (typeof value !== 'string') return 'system';

  const normalized = value.trim().toLowerCase();
  if (normalized === 'guardian_request' || normalized === 'sos' || normalized === 'checkin') {
    return normalized;
  }

  return 'system';
};

const toOptionalString = (value: string | object | undefined): string | undefined => {
  if (typeof value === 'string') return value;
  if (value === undefined) return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const parseLocation = (
  value: string | object | undefined,
): { latitude: number; longitude: number } | undefined => {
  if (!value) return undefined;

  const normalize = (input: any) => {
    const latitude = Number(input?.latitude ?? input?.lat);
    const longitude = Number(input?.longitude ?? input?.lon ?? input?.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return undefined;
    return { latitude, longitude };
  };

  if (typeof value === 'string') {
    try {
      return normalize(JSON.parse(value));
    } catch {
      return undefined;
    }
  }

  return normalize(value);
};

export const handleRemoteMessage = async (
  remoteMessage: RemoteMessage,
): Promise<void> => {
  const data = remoteMessage.data || {};
  const type = parseIncomingType(data.type);

  if (type === 'guardian_request') {
    await NotificationService.addGuardianRequest({
      requesterName: toOptionalString(data.requesterName) || i18n.t('guardian_generic'),
      requesterPhone: toOptionalString(data.requesterPhone),
      requesterId: toOptionalString(data.requesterId),
      requestId: toOptionalString(data.requestId),
    });
    return;
  }

  if (type === 'sos') {
    const senderName = toOptionalString(data.senderName) || i18n.t('guardian_generic');
    const notification = {
      id: `sos-${data.id || Date.now()}`,
      type: 'sos',
      title: toOptionalString(data.title) || i18n.t('sos_from_guardian'),
      summary:
        toOptionalString(data.summary) ||
        i18n.t('guardian_requested_help', { name: senderName }),
      timestamp: toOptionalString(data.timestamp) || new Date().toISOString(),
      data: {
        senderName,
        location: parseLocation(data.location),
        message: toOptionalString(data.message),
      },
    } as const;

    await NotificationService.add(notification);
    await ImportantAlertsService.ingestAlerts([notification]);
    return;
  }

  if (type === 'checkin') {
    // Disabled by product decision: do not surface automatic check-in warnings.
    await NotificationService.cleanupDisabledCheckInNotifications();
    return;
  }

  const notification = {
    id: `notif-${Date.now()}`,
    type: 'system',
    title: remoteMessage.notification?.title || i18n.t('notification_default_title'),
    summary: remoteMessage.notification?.body || i18n.t('notification_default_summary'),
    timestamp: new Date().toISOString(),
    data,
  } as const;

  await NotificationService.add(notification);
  await ImportantAlertsService.ingestAlerts([notification]);
};
