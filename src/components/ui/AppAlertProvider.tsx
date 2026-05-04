import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  type AlertButton,
} from 'react-native';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import AppText from './AppText';
import BasePopup from './BasePopup';
import {
  installAppAlertPresenter,
  type AppAlertRequest,
} from './AppAlert';

type ButtonTone = 'primary' | 'secondary' | 'danger' | 'cancel';

const getButtonTone = (
  button: AlertButton,
  index: number,
  buttons: AlertButton[],
): ButtonTone => {
  if (button.style === 'destructive') return 'danger';
  if (button.style === 'cancel') return 'cancel';
  if (button.isPreferred) return 'primary';

  const hasCancel = buttons.some(item => item.style === 'cancel');
  if (buttons.length === 1) return 'primary';
  if (hasCancel && index === buttons.length - 1) return 'primary';
  return 'secondary';
};

export const AppAlertProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { colors, isDark } = useTheme();
  const [queue, setQueue] = useState<AppAlertRequest[]>([]);
  const active = queue[0] ?? null;
  const activeRef = useRef<AppAlertRequest | null>(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const enqueueAlert = useCallback((request: AppAlertRequest) => {
    setQueue(prev => [...prev, request]);
  }, []);

  useEffect(
    () => installAppAlertPresenter(enqueueAlert),
    [enqueueAlert],
  );

  const removeActive = useCallback((notifyDismiss: boolean) => {
    const request = activeRef.current;
    if (notifyDismiss) {
      request?.options?.onDismiss?.();
    }
    setQueue(prev => {
      if (!request) return prev.slice(1);
      if (prev[0]?.id === request.id) return prev.slice(1);
      return prev.filter(item => item.id !== request.id);
    });
  }, []);

  const handleButtonPress = useCallback(
    (button: AlertButton) => {
      removeActive(false);
      button.onPress?.();
    },
    [removeActive],
  );

  const actionLayout = useMemo(() => {
    if (!active) return 'vertical';
    if (active.placement === 'bottom') return 'vertical';
    return active.buttons.length <= 2 ? 'horizontal' : 'vertical';
  }, [active]);

  const buttonItems = active?.buttons ?? [];
  const hasMessage = typeof active?.message === 'string' && active.message.trim().length > 0;

  return (
    <>
      {children}
      <BasePopup
        accessibilityLabel={active?.title}
        avoidKeyboard
        backdropAccessibilityLabel={active?.title || 'Close popup'}
        contentStyle={[
          styles.dialogSurface,
          active?.placement === 'bottom' ? styles.actionSheetSurface : null,
        ]}
        maxWidth={active?.placement === 'bottom' ? 560 : 500}
        onClose={() => removeActive(true)}
        placement={active?.placement ?? 'center'}
        showHandle={active?.placement === 'bottom'}
        testID="app-alert-dialog"
        visible={Boolean(active)}
      >
        {active ? (
          <View>
            <View
              style={[
                styles.dialogHeader,
                active.placement === 'bottom' ? styles.sheetHeader : styles.centerHeader,
              ]}
            >
              <AppText
                maxFontSizeMultiplier={1.45}
                style={[
                  styles.dialogTitle,
                  {
                    color: colors.text,
                    textAlign: active.placement === 'bottom' ? 'left' : 'center',
                  },
                ]}
                variant="modalTitle"
              >
                {active.title}
              </AppText>
              {hasMessage ? (
                <AppText
                  maxFontSizeMultiplier={1.9}
                  style={[
                    styles.dialogMessage,
                    {
                      color: colors.textSecondary,
                      textAlign: active.placement === 'bottom' ? 'left' : 'center',
                    },
                  ]}
                  variant="modalBody"
                >
                  {active.message}
                </AppText>
              ) : null}
            </View>

            <ScrollView
              bounces={false}
              contentContainerStyle={[
                styles.actions,
                actionLayout === 'horizontal' ? styles.actionsHorizontal : styles.actionsVertical,
              ]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              {buttonItems.map((button, index) => {
                const tone = getButtonTone(button, index, buttonItems);
                const filled = tone === 'primary' || tone === 'danger';
                const buttonColor =
                  tone === 'danger'
                    ? colors.alert
                    : tone === 'primary'
                      ? colors.primary
                      : isDark
                        ? 'rgba(255,255,255,0.08)'
                        : 'rgba(17,24,39,0.04)';
                const textColor = filled
                  ? '#FFFFFF'
                  : tone === 'cancel'
                    ? colors.textSecondary
                    : colors.text;

                return (
                  <TouchableOpacity
                    accessibilityRole="button"
                    activeOpacity={0.86}
                    key={`${button.text || 'OK'}-${index}`}
                    onPress={() => handleButtonPress(button)}
                    style={[
                      styles.actionButton,
                      actionLayout === 'horizontal' ? styles.actionButtonHorizontal : null,
                      {
                        backgroundColor: buttonColor,
                        borderColor: filled
                          ? buttonColor
                          : isDark
                            ? 'rgba(255,255,255,0.12)'
                            : 'rgba(15,23,42,0.08)',
                      },
                    ]}
                  >
                    <AppText
                      maxFontSizeMultiplier={1.45}
                      style={[styles.actionText, { color: textColor }]}
                      variant="modalAction"
                    >
                      {button.text || 'OK'}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        ) : null}
      </BasePopup>
    </>
  );
};

const styles = StyleSheet.create({
  dialogSurface: {
    padding: ThemeTokens.spacing.lg,
  },
  actionSheetSurface: {
    paddingTop: ThemeTokens.spacing.md,
  },
  dialogHeader: {
    gap: ThemeTokens.spacing.sm,
  },
  centerHeader: {
    alignItems: 'center',
  },
  sheetHeader: {
    alignItems: 'stretch',
  },
  dialogTitle: {
    letterSpacing: Platform.OS === 'ios' ? -0.2 : 0,
  },
  dialogMessage: {
    marginTop: 2,
  },
  actions: {
    paddingTop: ThemeTokens.spacing.lg,
  },
  actionsHorizontal: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.sm,
  },
  actionsVertical: {
    gap: ThemeTokens.spacing.sm,
  },
  actionButton: {
    minHeight: 52,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: ThemeTokens.spacing.sm,
  },
  actionButtonHorizontal: {
    flex: 1,
  },
  actionText: {
    textAlign: 'center',
  },
});

export default AppAlertProvider;
