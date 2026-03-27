import React from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from './AppText';

type AppModalProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
};

export const AppModal: React.FC<AppModalProps> = ({
  visible,
  onClose,
  title,
  children,
}) => {
  const { colors } = useTheme();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border },
          ]}
          onPress={() => {}}
        >
          {title ? (
            <AppText variant="modalTitle" style={[styles.title, { color: colors.text }]}>
              {title}
            </AppText>
          ) : null}
          <View style={styles.content}>{children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(6,8,12,0.56)',
    justifyContent: 'center',
    padding: ThemeTokens.spacing.xl,
  },
  card: {
    borderRadius: ThemeTokens.radius.xl,
    padding: ThemeTokens.spacing.xl,
    borderWidth: 1,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    ...Platform.select({
      ios: ThemeTokens.shadows.medium.ios,
      android: ThemeTokens.shadows.medium.android,
    }),
  },
  title: {
    marginBottom: ThemeTokens.spacing.sm,
  },
  content: {
    gap: ThemeTokens.spacing.md,
  },
});
