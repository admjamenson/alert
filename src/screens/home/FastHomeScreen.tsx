import React, { useEffect } from 'react';
import {
  Dimensions,
  InteractionManager,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { ensureI18nReady } from '../../i18n/bootstrap';
import { performance } from '../../utils/performance';

const { width } = Dimensions.get('window');
const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;
const FAST_HOME_BACKGROUND = '#FFFFFF';

const FastHomeScreen: React.FC<any> = ({ navigation }) => {
  useEffect(() => {
    let cancelled = false;
    let delayId: ReturnType<typeof setTimeout> | null = null;
    let interactionTask: { cancel?: () => void } | null = null;

    const frame = requestAnimationFrame(() => {
      void ensureI18nReady();
      performance.mark('fast_home_visible');
      const measure = performance.measure(
        'fast_home_visible',
        'app_init',
        'fast_home_visible',
      );
      if (__DEV__) {
        console.log(
          `[ALERT-PERF] fast_home_visible=${Math.round(
            measure?.duration || 0,
          )}ms`,
        );
      }

      interactionTask = InteractionManager.runAfterInteractions(() => {
        delayId = setTimeout(() => {
          if (!cancelled) {
            navigation.replace('Home');
          }
        }, 0);
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      if (delayId) {
        clearTimeout(delayId);
      }
      if (typeof interactionTask?.cancel === 'function') {
        interactionTask.cancel();
      }
    };
  }, [navigation]);

  return (
    <View style={styles.container}>
      <StatusBar
        barStyle="dark-content"
        translucent={false}
        backgroundColor={FAST_HOME_BACKGROUND}
      />
      <SafeAreaView edges={['top']} style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.brand}>Alert</Text>
          <View style={styles.headerActions}>
            <View style={styles.iconCircle} />
            <View style={styles.iconCircle} />
            <View style={styles.iconCircle} />
          </View>
        </View>

        <View style={styles.weatherCard} />
        <View style={styles.mapCard} />

        <View style={styles.centerContent}>
          <View style={styles.sosWrap}>
            <View style={styles.sosGlow} />
            <TouchableOpacity
              activeOpacity={0.9}
              style={styles.sosButton}
              onPress={() => navigation.replace('Home')}
            >
              <Text style={styles.sosText}>SOS</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.messagesWrap}>
          <View style={styles.messagesBar}>
            <Icon name="message-text-outline" size={20} color="#111111" />
            <Text style={styles.messagesText}>Mensagens</Text>
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: FAST_HOME_BACKGROUND,
  },
  safe: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: ThemeTokens.spacing.xl,
    paddingVertical: ThemeTokens.spacing.md,
  },
  brand: {
    color: ThemeTokens.colors.light.alert,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  headerActions: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.md,
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F7F7F7',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.06)',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  weatherCard: {
    height: 208,
    marginHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.md,
    borderRadius: ThemeTokens.radius.xl,
    backgroundColor: ThemeTokens.colors.light.alert,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  mapCard: {
    height: 230,
    marginHorizontal: ThemeTokens.spacing.lg,
    marginTop: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.xl,
    backgroundColor: '#F6F6F6',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.06)',
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  centerContent: {
    alignItems: 'center',
    marginTop: ThemeTokens.spacing.xl,
    marginBottom: ThemeTokens.spacing.lg,
  },
  sosWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosGlow: {
    position: 'absolute',
    width: width * 0.78,
    height: width * 0.78,
    borderRadius: (width * 0.78) / 2,
    backgroundColor: 'rgba(230,28,36,0.08)',
  },
  sosButton: {
    width: width * 0.6,
    height: width * 0.6,
    borderRadius: (width * 0.6) / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E61C24',
    borderWidth: 6,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  sosText: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: 28,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.emergency,
  },
  messagesWrap: {
    position: 'absolute',
    left: ThemeTokens.spacing.lg,
    right: ThemeTokens.spacing.lg,
    bottom: ThemeTokens.spacing.lg,
  },
  messagesBar: {
    height: 52,
    borderRadius: ThemeTokens.radius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: 'rgba(17,17,17,0.08)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: ThemeTokens.spacing.sm,
    ...Platform.select({
      ios: ThemeTokens.shadows.soft.ios,
      android: ThemeTokens.shadows.soft.android,
    }),
  },
  messagesText: {
    color: '#111111',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default FastHomeScreen;
