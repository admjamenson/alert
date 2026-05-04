import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  findNodeHandle,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import {
  markStartupPhase,
  getStartupDelta,
} from './startupTelemetry';
import {
  CriticalSosOutcome,
  triggerCriticalHaptic,
  triggerCriticalSos,
} from './SosCriticalPath';

type EmergencyEntryShellProps = {
  mainAppMounted: boolean;
};

type SosVisualState = 'ready' | 'sending' | 'accepted' | 'queued' | 'failed';

const COPY = {
  title: 'Alert',
  subtitle: 'Entrada de emergência pronta',
  ready: 'SOS pronto',
  sending: 'Enviando SOS agora',
  accepted: 'SOS acionado',
  queued: 'SOS protegido e em fila',
  failed: 'SOS não enviado. Abra o app completo para revisar guardiões e localização.',
  label: 'Acionar SOS agora',
  hint:
    'Envia um pedido de ajuda prioritário usando os dados seguros já disponíveis no dispositivo.',
  appLoading: 'Carregando recursos adicionais em segundo plano',
  appReady: 'App completo pronto',
};

const getSosText = (state: SosVisualState) => {
  if (state === 'sending') return COPY.sending;
  if (state === 'accepted') return COPY.accepted;
  if (state === 'queued') return COPY.queued;
  if (state === 'failed') return COPY.failed;
  return COPY.ready;
};

const mapOutcomeToState = (outcome: CriticalSosOutcome): SosVisualState => {
  if (outcome === 'accepted') return 'accepted';
  if (outcome === 'queued') return 'queued';
  return 'failed';
};

const EmergencyEntryShell: React.FC<EmergencyEntryShellProps> = ({
  mainAppMounted,
}) => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const buttonRef = useRef<View>(null);
  const markedMountRef = useRef(false);
  const [sosState, setSosState] = useState<SosVisualState>('ready');

  if (!markedMountRef.current) {
    markedMountRef.current = true;
    markStartupPhase('CRITICAL_SHELL_MOUNT_BEGIN');
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      markStartupPhase('CRITICAL_SHELL_FIRST_FRAME');
      markStartupPhase('SOS_READY');
      const node = findNodeHandle(buttonRef.current);
      if (node) {
        AccessibilityInfo.setAccessibilityFocus(node);
      }
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  const handleSosPress = useCallback(() => {
    if (sosState === 'sending') return;
    markStartupPhase('SOS_TAP', { overwrite: true });
    triggerCriticalHaptic('press');
    setSosState('sending');
    void triggerCriticalSos().then(outcome => {
      setSosState(mapOutcomeToState(outcome));
      AccessibilityInfo.announceForAccessibility(getSosText(mapOutcomeToState(outcome)));
    });
  }, [sosState]);

  const shellFrameDelta = getStartupDelta('CRITICAL_SHELL_FIRST_FRAME');
  const sosReadyDelta = getStartupDelta('SOS_READY');

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isDark ? '#0B0B0D' : '#FFFFFF' },
      ]}
      accessibilityViewIsModal
    >
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
        backgroundColor={isDark ? '#0B0B0D' : '#FFFFFF'}
      />
      <View style={styles.header}>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.4}
          style={[styles.brand, { color: '#E61C24' }]}
        >
          {COPY.title}
        </Text>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.3}
          style={[styles.status, { color: isDark ? '#F3F4F6' : '#111111' }]}
        >
          {mainAppMounted ? COPY.appReady : COPY.appLoading}
        </Text>
      </View>

      <View style={styles.content}>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.45}
          style={[styles.subtitle, { color: isDark ? '#FFFFFF' : '#111111' }]}
        >
          {COPY.subtitle}
        </Text>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.35}
          style={[styles.readyText, { color: isDark ? '#C8CDD6' : '#5B616E' }]}
        >
          {getSosText(sosState)}
        </Text>

        <View style={styles.sosStage}>
          <View style={styles.outerRing} />
          <View style={styles.middleRing} />
          <Pressable
            ref={buttonRef}
            accessibilityRole="button"
            accessibilityLabel={COPY.label}
            accessibilityHint={COPY.hint}
            accessibilityState={{ busy: sosState === 'sending' }}
            onPress={handleSosPress}
            disabled={sosState === 'sending'}
            style={({ pressed }) => [
              styles.sosButton,
              pressed && styles.sosPressed,
              sosState === 'sending' && styles.sosSending,
              sosState === 'accepted' && styles.sosAccepted,
              sosState === 'queued' && styles.sosQueued,
              sosState === 'failed' && styles.sosFailed,
            ]}
          >
            <Text
              allowFontScaling
              maxFontSizeMultiplier={1.25}
              style={styles.sosLabel}
            >
              SOS
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.footer}>
        <Text
          allowFontScaling
          maxFontSizeMultiplier={1.25}
          style={[styles.metric, { color: isDark ? '#AEB6C2' : '#68707D' }]}
        >
          Shell {shellFrameDelta ?? '--'}ms | SOS {sosReadyDelta ?? '--'}ms
        </Text>
      </View>
    </View>
  );
};

const FONT_FAMILY = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'sans-serif',
});

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight || 0 : 44,
  },
  header: {
    minHeight: 86,
    paddingHorizontal: 28,
    paddingTop: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  brand: {
    fontFamily: FONT_FAMILY,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: '800',
  },
  status: {
    flex: 1,
    textAlign: 'right',
    fontFamily: FONT_FAMILY,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  subtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 12,
  },
  readyText: {
    fontFamily: FONT_FAMILY,
    fontSize: 17,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 36,
    minHeight: 50,
  },
  sosStage: {
    width: 328,
    height: 328,
    alignItems: 'center',
    justifyContent: 'center',
  },
  outerRing: {
    position: 'absolute',
    width: 328,
    height: 328,
    borderRadius: 164,
    backgroundColor: 'rgba(230,28,36,0.07)',
  },
  middleRing: {
    position: 'absolute',
    width: 276,
    height: 276,
    borderRadius: 138,
    backgroundColor: 'rgba(230,28,36,0.12)',
  },
  sosButton: {
    width: 224,
    height: 224,
    borderRadius: 112,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E61C24',
    borderWidth: 8,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  sosPressed: {
    transform: [{ scale: 0.98 }],
  },
  sosSending: {
    backgroundColor: '#B5131A',
  },
  sosAccepted: {
    backgroundColor: '#167A3A',
  },
  sosQueued: {
    backgroundColor: '#9C5A00',
  },
  sosFailed: {
    backgroundColor: '#8D1117',
  },
  sosLabel: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: 54,
    lineHeight: 62,
    fontWeight: '800',
    letterSpacing: 0,
  },
  footer: {
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 10,
  },
  metric: {
    fontFamily: FONT_FAMILY,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});

export default EmergencyEntryShell;
