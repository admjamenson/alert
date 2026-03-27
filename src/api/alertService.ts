/**
 * ALERT SERVICE - Local & Remote Notifications
 */

import { Platform, Alert as RNAlert } from 'react-native';
import {
  AuthorizationStatus,
  FirebaseMessagingTypes,
  deleteToken,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  requestPermission,
} from '@react-native-firebase/messaging';
import { handleRemoteMessage } from '../services/PushNotificationService';

type RemoteMessage = FirebaseMessagingTypes.RemoteMessage;
const messagingClient = getMessaging();

export interface Alert {
  id: string;
  title: string;
  description: string;
  image?: string;
  timestamp: number;
}

export const fetchAlerts = async (): Promise<Alert[]> => {
  await new Promise<void>(resolve => setTimeout(resolve, 1000));

  return [
    {
      id: '1',
      title: 'Alerta de chuva forte',
      description: 'Previsao de fortes chuvas nas proximas 24 horas. Mantenha-se seguro.',
      image: 'https://example.com/rain.png',
      timestamp: Date.now() - 3600000 * 2,
    },
    {
      id: '2',
      title: 'Interrupcao de energia',
      description: 'Manutencao programada na rede eletrica local.',
      image: 'https://example.com/power.png',
      timestamp: Date.now() - 3600000,
    },
    {
      id: '3',
      title: 'Evento comunitario',
      description: 'Feira local no centro da cidade hoje.',
      image: 'https://example.com/event.png',
      timestamp: Date.now() + 3600000 * 4,
    },
    {
      id: '4',
      title: 'Novo codigo postal',
      description: 'Seu bairro possui um novo codigo postal: XXXXX-XXX.',
      image: 'https://example.com/postal.png',
      timestamp: Date.now() - 3600000 * 10,
    },
  ];
};

export const setupPushNotifications = async (): Promise<void> => {
  try {
    if (Platform.OS === 'ios') {
      const authStatus = await requestPermission(messagingClient);
      const enabled =
        authStatus === AuthorizationStatus.AUTHORIZED ||
        authStatus === AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        throw new Error('Notification permission denied on iOS.');
      }
    }

    await getToken(messagingClient);

    onMessage(messagingClient, async (remoteMessage: RemoteMessage) => {
      if (__DEV__) {
        console.log('[AlertService] Foreground push received.');
      }
      await handleRemoteMessage(remoteMessage);

      if (remoteMessage.notification?.title || remoteMessage.notification?.body) {
        RNAlert.alert(
          remoteMessage.notification?.title ?? 'Nova notificacao',
          remoteMessage.notification?.body ?? 'Voce recebeu uma nova mensagem.',
        );
      }
    });

    onNotificationOpenedApp(messagingClient, () => {
      if (__DEV__) {
        console.log('[AlertService] Notification opened from background.');
      }
    });

    const initialMessage = await getInitialNotification(messagingClient);
    if (initialMessage && __DEV__) {
      console.log('[AlertService] Notification opened from quit state.');
    }

    if (__DEV__) {
      console.log('[AlertService] Push notifications configured.');
    }
  } catch (error) {
    console.error('[AlertService] Error configuring notifications:', error);
    RNAlert.alert(
      'Erro de notificacao',
      'Nao foi possivel configurar as notificacoes agora. Tente novamente.',
    );
    throw error;
  }
};

export const clearNotifications = async (): Promise<void> => {
  try {
    await deleteToken(messagingClient);
    if (__DEV__) {
      console.log('[AlertService] Notification token cleared.');
    }
  } catch (error) {
    console.error('[AlertService] Error clearing token:', error);
  }
};

export const requestNotificationPermission = async (): Promise<void> => {
  try {
    const authStatus = await requestPermission(messagingClient);
    const granted =
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL;

    if (__DEV__) {
      console.log(`[AlertService] Notification permission: ${granted ? 'granted' : 'denied'}.`);
    }
  } catch (error) {
    console.error('[AlertService] Error requesting permission:', error);
  }
};

export const checkNotificationPermission = async (): Promise<boolean> => {
  try {
    const authStatus = await requestPermission(messagingClient);
    return (
      authStatus === AuthorizationStatus.AUTHORIZED ||
      authStatus === AuthorizationStatus.PROVISIONAL
    );
  } catch (error) {
    console.error('[AlertService] Error checking notification permission:', error);
    return false;
  }
};

export const getNotificationToken = async (): Promise<string | null> => {
  try {
    return await getToken(messagingClient);
  } catch (error) {
    console.error('[AlertService] Error getting token:', error);
    return null;
  }
};

export const onNotificationReceived = (
  callback: (notification: RemoteMessage) => void,
): void => {
  onMessage(messagingClient, callback);
  onNotificationOpenedApp(messagingClient, callback);

  getInitialNotification(messagingClient).then(message => {
    if (message) {
      callback(message);
    }
  });
};
