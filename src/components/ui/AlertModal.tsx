import React from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from './AppText';
import BasePopup from './BasePopup';

type AlertModalProps = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  iconColor?: string;
  children?: React.ReactNode;
  primaryAction?: {
    label: string;
    onPress: () => void;
    loading?: boolean;
    danger?: boolean;
  };
  secondaryAction?: {
    label: string;
    onPress: () => void;
  };
};

export const AlertModal: React.FC<AlertModalProps> = ({
  visible,
  onClose,
  title,
  subtitle,
  icon,
  iconColor,
  children,
  primaryAction,
  secondaryAction,
}) => {
  const { colors } = useTheme();

  return (
    <BasePopup
      accessibilityLabel={title}
      contentStyle={styles.card}
      maxWidth={560}
      onClose={onClose}
      placement="bottom"
      showHandle
      visible={visible}
    >
      <View style={styles.header}>
        {icon ? (
          <View style={[styles.iconWrap, { backgroundColor: (iconColor || colors.primary) + '15' }]}>
            <Icon name={icon} size={28} color={iconColor || colors.primary} />
          </View>
        ) : null}
        <TouchableOpacity
          accessibilityLabel="Close"
          accessibilityRole="button"
          onPress={onClose}
          style={styles.closeBtn}
        >
          <Icon name="close" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <View style={styles.textWrap}>
        <AppText variant="title2" style={{ color: colors.text }}>{title}</AppText>
        {subtitle ? (
          <AppText variant="body" style={[styles.subtitle, { color: colors.textSecondary }]}>
            {subtitle}
          </AppText>
        ) : null}
      </View>

      <View style={styles.content}>{children}</View>

      <View style={styles.footer}>
        {secondaryAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={secondaryAction.onPress}
            style={[styles.btn, styles.secondaryBtn, { borderColor: colors.border }]}
          >
            <AppText style={{ color: colors.text }}>{secondaryAction.label}</AppText>
          </TouchableOpacity>
        ) : null}

        {primaryAction ? (
          <TouchableOpacity
            accessibilityRole="button"
            onPress={primaryAction.onPress}
            disabled={primaryAction.loading}
            style={[
              styles.btn,
              styles.primaryBtn,
              { backgroundColor: primaryAction.danger ? colors.alert : colors.primary }
            ]}
          >
            <AppText style={styles.primaryBtnText}>
              {primaryAction.loading ? '...' : primaryAction.label}
            </AppText>
          </TouchableOpacity>
        ) : null}
      </View>
    </BasePopup>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: ThemeTokens.spacing.xl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: ThemeTokens.spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    marginBottom: ThemeTokens.spacing.lg,
  },
  subtitle: {
    marginTop: ThemeTokens.spacing.xs,
  },
  content: {
    marginBottom: ThemeTokens.spacing.xl,
  },
  footer: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.md,
  },
  btn: {
    flex: 1,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {},
  primaryBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  secondaryBtn: {
    borderWidth: 1,
  },
});
