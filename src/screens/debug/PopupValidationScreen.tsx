import React, {useCallback, useState} from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';
import {SafeAreaView} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import GlobalCountryPicker, {
  type GlobalCountrySelection,
} from '../../components/country/GlobalCountryPicker';
import {ThemeTokens} from '../../constants/ThemeTokens';
import {useTheme} from '../../context/ThemeContext';
import type {RootStackParamList} from '../../navigation/types';
import {NotificationService} from '../../services/NotificationService';
import {GUARDIANS_CONVERSATION_ID} from '../../services/chat/guardiansConversation';

type Props = NativeStackScreenProps<RootStackParamList, 'PopupValidation'>;

const VALIDATION_NOTIFICATION_ID = 'popup-validation-hazard';

const PopupValidationScreen = ({navigation}: Props) => {
  const {colors} = useTheme();
  const [countryVisible, setCountryVisible] = useState(false);
  const [countryCode, setCountryCode] = useState('BR');
  const [countryLabel, setCountryLabel] = useState('Brazil');

  const handleCountrySelect = useCallback((payload: GlobalCountrySelection) => {
    setCountryCode(payload.cca2);
    setCountryLabel(`${payload.flag} ${payload.name}`);
    setCountryVisible(false);
  }, []);

  const seedNotification = useCallback(async () => {
    await NotificationService.add({
      id: VALIDATION_NOTIFICATION_ID,
      type: 'hazard',
      title: 'Popup validation alert',
      summary: 'Debug notification for validating the details popup.',
      timestamp: new Date().toISOString(),
      sourceName: 'Alert debug',
      data: {
        area: 'Samsung validation session',
        kind: 'popup_validation',
      },
    });
    navigation.navigate('Notifications');
  }, [navigation]);

  const openChatThread = useCallback(() => {
    navigation.navigate('ChatThread', {
      conversationId: GUARDIANS_CONVERSATION_ID,
      title: 'Guardians',
      memberIds: [],
      type: 'group',
    });
  }, [navigation]);

  const openChatMonitor = useCallback(() => {
    navigation.navigate('ChatMonitor', {
      lat: -3.7319,
      lon: -38.5267,
      user: 'Popup validation',
      message: 'Debug monitor session',
    });
  }, [navigation]);

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.container, {backgroundColor: colors.background}]}>
      <View style={[styles.header, {borderBottomColor: colors.border}]}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={() => navigation.goBack()}
          style={[styles.iconBtn, {borderColor: colors.border}]}>
          <Icon name="arrow-left" size={22} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={[styles.title, {color: colors.text}]}>
            Popup validation
          </Text>
          <Text style={[styles.subtitle, {color: colors.textSecondary}]}>
            Debug-only access without resetting the session.
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <ActionButton
          colors={colors}
          icon="map-marker-alert-outline"
          label="Open ChatMonitor"
          onPress={openChatMonitor}
        />
        <ActionButton
          colors={colors}
          icon="flag-outline"
          label={`Country picker: ${countryLabel}`}
          onPress={() => setCountryVisible(true)}
        />
        <ActionButton
          colors={colors}
          icon="bell-plus-outline"
          label="Seed notification popup"
          onPress={() => void seedNotification()}
        />
        <ActionButton
          colors={colors}
          icon="message-text-outline"
          label="Open ChatThread"
          onPress={openChatThread}
        />
        <ActionButton
          colors={colors}
          icon="alert-circle-outline"
          label="Test global alert"
          onPress={() =>
            Alert.alert(
              'Popup validation',
              'This verifies the global alert provider.',
            )
          }
        />
      </ScrollView>

      <GlobalCountryPicker
        onClose={() => setCountryVisible(false)}
        onSelect={handleCountrySelect}
        selectedCountryCode={countryCode}
        visible={countryVisible}
      />
    </SafeAreaView>
  );
};

const ActionButton = ({
  colors,
  icon,
  label,
  onPress,
}: {
  colors: ReturnType<typeof useTheme>['colors'];
  icon: string;
  label: string;
  onPress: () => void;
}) => (
  <TouchableOpacity
    accessibilityRole="button"
    activeOpacity={0.82}
    onPress={onPress}
    style={[
      styles.action,
      {backgroundColor: colors.surface, borderColor: colors.border},
    ]}>
    <Icon name={icon} size={22} color={colors.text} />
    <Text style={[styles.actionText, {color: colors.text}]}>{label}</Text>
    <Icon name="chevron-right" size={22} color={colors.textSecondary} />
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.md,
  },
  iconBtn: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  content: {
    gap: 12,
    padding: ThemeTokens.spacing.md,
  },
  action: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 56,
    paddingHorizontal: ThemeTokens.spacing.md,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
  },
});

export default PopupValidationScreen;
