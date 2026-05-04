import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';

export type BasePopupPlacement = 'center' | 'bottom';

type BasePopupProps = {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  placement?: BasePopupPlacement;
  contentStyle?: StyleProp<ViewStyle>;
  contentWrapperStyle?: StyleProp<ViewStyle>;
  maxWidth?: number;
  dismissOnBackdropPress?: boolean;
  showHandle?: boolean;
  avoidKeyboard?: boolean;
  accessibilityLabel?: string;
  backdropAccessibilityLabel?: string;
  testID?: string;
};

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

const ENTER_MS = 220;
const EXIT_MS = 170;

const stopContentPress = (event: GestureResponderEvent) => {
  event.stopPropagation();
};

export const BasePopup: React.FC<BasePopupProps> = ({
  visible,
  onClose,
  children,
  placement = 'center',
  contentStyle,
  contentWrapperStyle,
  maxWidth,
  dismissOnBackdropPress = true,
  showHandle,
  avoidKeyboard = false,
  accessibilityLabel,
  backdropAccessibilityLabel = 'Close popup',
  testID,
}) => {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
    }
  }, [visible]);

  useEffect(() => {
    if (!mounted) return;

    progress.stopAnimation();
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? ENTER_MS : EXIT_MS,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !visible) {
        setMounted(false);
      }
    });
  }, [mounted, progress, visible]);

  const handleBackdropPress = useCallback(() => {
    if (dismissOnBackdropPress) {
      onClose();
    }
  }, [dismissOnBackdropPress, onClose]);

  const backdropStyle = useMemo(
    () => ({
      backgroundColor: isDark ? 'rgba(2, 4, 10, 0.58)' : 'rgba(8, 13, 24, 0.34)',
      opacity: progress,
    }),
    [isDark, progress],
  );

  const surfaceTone = useMemo(
    () => ({
      backgroundColor: isDark ? colors.card : '#FFFFFF',
      borderColor: isDark ? 'rgba(255,255,255,0.14)' : 'rgba(15,23,42,0.08)',
      ...Platform.select({
        ios: {
          shadowColor: '#000000',
          shadowOffset: { width: 0, height: 18 },
          shadowOpacity: isDark ? 0.32 : 0.18,
          shadowRadius: 30,
        },
        android: {
          elevation: 18,
          shadowColor: '#000000',
        },
      }),
    }),
    [colors.card, isDark],
  );

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [placement === 'bottom' ? 34 : 10, 0],
    extrapolate: 'clamp',
  });

  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [placement === 'bottom' ? 1 : 0.96, 1],
    extrapolate: 'clamp',
  });

  const maxPopupHeight = Math.max(
    280,
    height - insets.top - insets.bottom - (placement === 'bottom' ? 56 : 112),
  );

  if (!mounted) {
    return null;
  }

  const popupSurface = (
    <View style={styles.root}>
      <AnimatedPressable
        accessibilityElementsHidden={!dismissOnBackdropPress}
        accessibilityLabel={backdropAccessibilityLabel}
        accessibilityRole="button"
        importantForAccessibility={dismissOnBackdropPress ? 'auto' : 'no-hide-descendants'}
        onPress={handleBackdropPress}
        style={[styles.backdrop, backdropStyle]}
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.contentHost,
          placement === 'bottom' ? styles.bottomHost : styles.centerHost,
          {
            paddingTop: Math.max(insets.top + 18, ThemeTokens.spacing.lg),
            paddingBottom:
              placement === 'bottom'
                ? Math.max(insets.bottom + 12, ThemeTokens.spacing.lg)
                : Math.max(insets.bottom + 18, ThemeTokens.spacing.lg),
          },
        ]}
      >
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.animatedWrap,
            { maxWidth: maxWidth ?? (placement === 'bottom' ? 640 : 540) },
            contentWrapperStyle,
            {
              opacity: progress,
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <Pressable
            accessibilityLabel={accessibilityLabel}
            accessibilityViewIsModal
            onPress={stopContentPress}
            style={[
              styles.surface,
              placement === 'bottom' ? styles.bottomSurface : styles.centerSurface,
              surfaceTone,
              { maxHeight: maxPopupHeight },
              contentStyle,
            ]}
            testID={testID}
          >
            {(showHandle ?? placement === 'bottom') ? (
              <View
                accessible={false}
                style={[
                  styles.handle,
                  {
                    backgroundColor: isDark
                      ? 'rgba(255,255,255,0.26)'
                      : 'rgba(60,60,67,0.24)',
                  },
                ]}
              />
            ) : null}
            {children}
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );

  return (
    <Modal
      animationType="none"
      hardwareAccelerated
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
      statusBarTranslucent
      transparent
      visible={mounted}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.root}
        >
          {popupSurface}
        </KeyboardAvoidingView>
      ) : (
        popupSurface
      )}
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  contentHost: {
    flex: 1,
    paddingHorizontal: ThemeTokens.spacing.lg,
  },
  centerHost: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomHost: {
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  animatedWrap: {
    width: '100%',
  },
  surface: {
    width: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  centerSurface: {
    borderRadius: 28,
    padding: ThemeTokens.spacing.lg,
  },
  bottomSurface: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.md,
    paddingBottom: ThemeTokens.spacing.lg,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: ThemeTokens.spacing.md,
  },
});

export default BasePopup;
