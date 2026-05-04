import React from 'react';
import {
  StyleSheet,
  View,
} from 'react-native';
import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from './AppText';
import BasePopup from './BasePopup';

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
  return (
    <BasePopup
      accessibilityLabel={title}
      maxWidth={520}
      onClose={onClose}
      placement="center"
      contentStyle={styles.card}
      visible={visible}
    >
      {title ? (
        <AppText variant="modalTitle" style={styles.title}>
          {title}
        </AppText>
      ) : null}
      <View style={styles.content}>{children}</View>
    </BasePopup>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: ThemeTokens.spacing.xl,
  },
  title: {
    marginBottom: ThemeTokens.spacing.sm,
  },
  content: {
    gap: ThemeTokens.spacing.md,
  },
});
