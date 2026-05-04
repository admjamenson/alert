import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { AlertNotification, NotificationType, SosPayload, GuardianRequestPayload } from '../../types/notifications';
import { GetRiskFeedQuery } from '../../application/queries/GetRiskFeedQuery';
import { NotificationService } from '../../services/NotificationService';
import { ImportantAlertsService } from '../../services/ImportantAlertsService';
import { useSecurity } from '../../context/SecurityContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'react-native-localize';
import { GuardianNetworkService } from '../../services/GuardianNetworkService';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { ImportantAlert } from '../../services/importantAlertUtils';
import BasePopup from '../../components/ui/BasePopup';

const typeIcon: Record<NotificationType, string> = {
  hazard: 'weather-lightning-rainy',
  sos: 'shield-alert',
  guardian: 'account-heart',
  guardian_request: 'account-question',
  system: 'shield-check',
};

const typeColor: Record<NotificationType, string> = {
  hazard: '#FF6B00',
  sos: '#FF0000',
  guardian: '#2E7D32',
  guardian_request: '#1565C0',
  system: '#1565C0',
};

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const isImportantAlertItem = (item: AlertNotification | null | undefined): boolean =>
  String((item as any)?.data?.kind || '') === 'important_alert';

const mapImportantToNotification = (item: ImportantAlert): AlertNotification => ({
  id: item.id,
  type: item.type === 'sos' ? 'sos' : 'hazard',
  title:
    item.title ||
    (item.severity === 'critical'
      ? 'Alerta critico perto de voce'
      : 'Atencao na sua area'),
  summary:
    item.summary ||
    (item.source === 'proximity' || item.source === 'route'
      ? 'SOS a ate 5 km'
      : 'Alerta destacado ativo'),
  timestamp: item.timestamp,
  sourceName: item.sourceName,
  data: {
    ...(typeof item.data === 'object' && item.data ? (item.data as Record<string, any>) : {}),
    kind: 'important_alert',
    importantMeta: {
      source: item.source,
      severity: item.severity,
      category: item.category,
      read: item.read,
    },
  },
});

const dedupeByIdKeepFirst = (items: AlertNotification[]): AlertNotification[] => {
  const seen = new Set<string>();
  const next: AlertNotification[] = [];
  items.forEach(item => {
    const key = String(item?.id || '');
    if (!key || seen.has(key)) return;
    seen.add(key);
    next.push(item);
  });
  return next;
};

export const NotificationsScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { securityState } = useSecurity();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<AlertNotification[]>([]);
  const [selected, setSelected] = useState<AlertNotification | null>(null);
  const [detailsVisible, setDetailsVisible] = useState(false);
  const [storedIds, setStoredIds] = useState<Set<string>>(new Set());
  const [undoItem, setUndoItem] = useState<{ item: AlertNotification; persisted: boolean } | null>(
    null,
  );
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    await NotificationService.cleanupDisabledCheckInNotifications();
    await NotificationService.seedIfEmpty();
    const lat = securityState.location?.latitude;
    const lon = securityState.location?.longitude;
    let alerts: AlertNotification[] = [];

    if (lat && lon) {
      const riskScore =
        securityState.riskLevel === 'high'
          ? 0.8
          : securityState.riskLevel === 'medium'
            ? 0.55
            : 0.2;
      alerts = await GetRiskFeedQuery.execute({
        latitude: lat,
        longitude: lon,
        riskScore,
      });
    }

    const centerState = await ImportantAlertsService.getState();
    const importantItems = centerState.importantAlerts.map(mapImportantToNotification);
    const stored = await NotificationService.getAll();
    setStoredIds(new Set(stored.map(item => item.id)));

    const active = await NotificationService.getActiveSos();
    if (active) {
      alerts.unshift({
        id: 'sos-active',
        type: 'sos',
        title: t('sos_from_guardian'),
        summary: t('guardian_requested_help', {
          name: active.senderName,
        }),
        timestamp: new Date().toISOString(),
        data: active,
      });
    }

    const combined = dedupeByIdKeepFirst([...importantItems, ...stored, ...alerts]).sort(
      (a, b) =>
        new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime(),
    );
    setItems(combined);
    await Promise.all([
      NotificationService.markAllSeen(),
      ImportantAlertsService.markAllRead(),
    ]);
  }, [
    securityState.location?.latitude,
    securityState.location?.longitude,
    securityState.riskLevel,
    t,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const unsub = navigation.addListener?.('focus', () => {
      void load();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [navigation, load]);

  const handleGuardianResponse = async (
    item: AlertNotification,
    accepted: boolean,
  ) => {
    const payload = item.data as GuardianRequestPayload | undefined;
    if (accepted && payload?.requesterName) {
      const raw = await AsyncStorage.getItem('@guardians_list');
      const list = raw ? JSON.parse(raw) : [];
      const next = [
        ...list,
        {
          id: `guardian-${Date.now()}`,
          name: payload.requesterName,
          phone: payload.requesterPhone || '',
          remoteId: payload.requesterId,
        },
      ];
      await AsyncStorage.setItem('@guardians_list', JSON.stringify(next));
    }
    await GuardianNetworkService.respondToGuardianRequest(
      payload?.requestId,
      accepted,
    );
    await NotificationService.remove(item.id);
    setItems(prev => prev.filter(entry => entry.id !== item.id));
  };

  const commitDelete = useCallback(
    async (item: AlertNotification) => {
      const persisted = storedIds.has(item.id);
      if (persisted) {
        await NotificationService.remove(item.id);
      }
      setItems(prev => prev.filter(entry => entry.id !== item.id));
      setDetailsVisible(false);
      setSelected(null);
      setUndoItem({ item, persisted });
      if (undoTimerRef.current) {
        clearTimeout(undoTimerRef.current);
      }
      undoTimerRef.current = setTimeout(() => {
        setUndoItem(null);
      }, 4500);
    },
    [storedIds],
  );

  const handleDelete = useCallback(
    (item: AlertNotification) => {
      Alert.alert(
        t('notifications_delete_title'),
        t('notifications_delete_body'),
        [
          { text: t('common_cancel'), style: 'cancel' },
          { text: t('notifications_delete_confirm'), style: 'destructive', onPress: () => void commitDelete(item) },
        ],
      );
    },
    [commitDelete, t],
  );

  const handleUndo = useCallback(async () => {
    if (!undoItem) return;
    if (undoItem.persisted) {
      await NotificationService.add(undoItem.item);
    }
    setItems(prev => [undoItem.item, ...prev]);
    setUndoItem(null);
  }, [undoItem]);

  const selectedArea =
    (selected as any)?.data?.area ||
    (selected as any)?.data?.locationName ||
    (selected as any)?.data?.region ||
    '';
  const selectedIsImportant = isImportantAlertItem(selected);

  const handlePress = async (item: AlertNotification) => {
    if (item.type === 'sos' && item.data) {
      const payload = item.data as SosPayload;
      await NotificationService.setActiveSos(payload);
      navigation.navigate('ChatMonitor', {
        targetLocation: payload.location,
        senderName: payload.senderName,
        message: payload.message,
      });
      return;
    }

    if (item.type === 'guardian_request') {
      return;
    }
    setSelected(item);
    setDetailsVisible(true);
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('notifications_title')}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={items}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Icon name="bell-off" size={26} color={colors.textSecondary} />
            <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
              {t('notifications_empty')}
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const localeTag = getLocales()?.[0]?.languageTag || 'pt-BR';
          return (
            <TouchableOpacity
              onPress={() => handlePress(item)}
              activeOpacity={item.type === 'guardian_request' ? 1 : 0.7}
              style={[
                styles.card,
                { backgroundColor: colors.card, borderColor: colors.border },
              ]}
            >
              <View
                style={[
                  styles.iconWrap,
                  { backgroundColor: typeColor[item.type] + '22' },
                ]}
              >
                <Icon
                  name={typeIcon[item.type]}
                  size={22}
                  color={typeColor[item.type]}
                />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: colors.text }]}>
                  {item.title}
                </Text>
                <Text style={[styles.cardSummary, { color: colors.textSecondary }]}>
                  {item.summary}
                </Text>
                <Text style={[styles.cardTime, { color: colors.textSecondary }]}>
                  {new Date(item.timestamp || 0).toLocaleString(localeTag)}
                </Text>
                {item.type === 'guardian_request' && (
                  <View style={styles.guardianActions}>
                    <TouchableOpacity
                      style={styles.acceptBtn}
                      onPress={() => handleGuardianResponse(item, true)}
                    >
                      <Text style={styles.acceptText}>{t('notifications_accept')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.rejectBtn}
                      onPress={() => handleGuardianResponse(item, false)}
                    >
                      <Text style={styles.rejectText}>{t('notifications_reject')}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
              {item.type !== 'guardian_request' && (
                <Icon name="chevron-right" size={24} color={colors.textSecondary} />
              )}
            </TouchableOpacity>
          );
        }}
      />

      <BasePopup
        accessibilityLabel={selected?.title}
        contentStyle={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}
        maxWidth={540}
        onClose={() => setDetailsVisible(false)}
        placement="center"
        visible={detailsVisible && Boolean(selected)}
      >
        <Text style={[styles.modalTitle, { color: colors.text }]}>{selected?.title}</Text>
        <Text style={[styles.modalBody, { color: colors.textSecondary }]}>
          {selected?.summary}
        </Text>
        <Text style={[styles.modalTime, { color: colors.textSecondary }]}>
          {selected?.timestamp
            ? new Date(selected.timestamp).toLocaleString(getLocales()?.[0]?.languageTag || 'pt-BR')
            : ''}
        </Text>
        {selected?.sourceName ? (
          <Text style={[styles.modalSource, { color: colors.textSecondary }]}>
            {t('notifications_source_label', { name: selected.sourceName })}
          </Text>
        ) : null}
        {selectedArea ? (
          <Text style={[styles.modalSource, { color: colors.textSecondary }]}>
            {t('notifications_area_label', { name: selectedArea })}
          </Text>
        ) : null}
        <View style={styles.modalActions}>
          {!selectedIsImportant ? (
            <TouchableOpacity
              accessibilityRole="button"
              style={[styles.modalDelete, { borderColor: colors.alert }]}
              onPress={() => selected && handleDelete(selected)}
            >
              <Text style={[styles.modalDeleteText, { color: colors.alert }]}>
                {t('notifications_delete_confirm')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity
            accessibilityRole="button"
            style={[styles.modalClose, { backgroundColor: colors.primary }]}
            onPress={() => setDetailsVisible(false)}
          >
            <Text style={styles.modalCloseText}>{t('close')}</Text>
          </TouchableOpacity>
        </View>
      </BasePopup>

      {undoItem ? (
        <View
          style={[
            styles.undoBar,
            { backgroundColor: colors.card, borderColor: colors.border, bottom: ThemeTokens.spacing.md + insets.bottom },
          ]}
        >
          <Text style={[styles.undoText, { color: colors.text }]}>{t('notifications_deleted')}</Text>
          <TouchableOpacity onPress={handleUndo} activeOpacity={0.85}>
            <Text style={[styles.undoAction, { color: colors.primary }]}>{t('notifications_undo')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingBottom: ThemeTokens.spacing.sm,
    paddingTop: ThemeTokens.spacing.xs,
  },
  title: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  list: { paddingHorizontal: ThemeTokens.spacing.lg, paddingBottom: ThemeTokens.spacing.xl },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    marginBottom: ThemeTokens.spacing.sm,
  },
  iconWrap: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, marginLeft: ThemeTokens.spacing.sm },
  cardTitle: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    marginBottom: 4,
    fontFamily: FONT_FAMILY,
  },
  cardSummary: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    marginBottom: 6,
    fontFamily: FONT_FAMILY,
  },
  cardTime: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  emptyState: {
    alignItems: 'center',
    marginTop: ThemeTokens.spacing.xl,
    gap: ThemeTokens.spacing.sm,
  },
  emptyText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontFamily: FONT_FAMILY,
  },
  guardianActions: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.sm,
    marginTop: ThemeTokens.spacing.sm,
  },
  acceptBtn: {
    flex: 1,
    height: 34,
    borderRadius: ThemeTokens.radius.md,
    backgroundColor: '#1E88E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectBtn: {
    flex: 1,
    height: 34,
    borderRadius: ThemeTokens.radius.md,
    backgroundColor: '#FF0000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    color: '#FFF',
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  rejectText: {
    color: '#FFF',
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    fontFamily: FONT_FAMILY,
  },
  modalCard: {
    borderRadius: 28,
    padding: ThemeTokens.spacing.xl,
    borderWidth: 1,
  },
  modalTitle: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    marginBottom: ThemeTokens.spacing.sm,
    fontFamily: FONT_FAMILY,
  },
  modalBody: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    marginBottom: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
  },
  modalTime: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    marginBottom: ThemeTokens.spacing.sm,
    fontFamily: FONT_FAMILY,
  },
  modalSource: {
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    marginBottom: ThemeTokens.spacing.md,
    fontFamily: FONT_FAMILY,
  },
  modalActions: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.sm,
    justifyContent: 'flex-end',
  },
  modalDelete: {
    minHeight: 50,
    paddingHorizontal: ThemeTokens.spacing.md,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDeleteText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontFamily: FONT_FAMILY,
  },
  modalClose: {
    minHeight: 50,
    paddingHorizontal: ThemeTokens.spacing.md,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCloseText: {
    color: '#FFF',
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontFamily: FONT_FAMILY,
  },
  undoBar: {
    position: 'absolute',
    left: ThemeTokens.spacing.lg,
    right: ThemeTokens.spacing.lg,
    height: 52,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  undoText: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    fontFamily: FONT_FAMILY,
  },
  undoAction: {
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
});
