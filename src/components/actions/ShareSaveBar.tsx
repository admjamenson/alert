import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from '../ui/AppText';

type Props = {
  shareLabel: string;
  saveLabel: string;
  onShare: () => void;
  onSave: () => void;
  saveBusy?: boolean;
  shareA11yHint?: string;
  saveA11yHint?: string;
};

export const ShareSaveBar: React.FC<Props> = ({
  shareLabel,
  saveLabel,
  onShare,
  onSave,
  saveBusy = false,
  shareA11yHint,
  saveA11yHint,
}) => (
  <View style={styles.row}>
    <TouchableOpacity
      style={styles.btn}
      onPress={onShare}
      accessibilityRole="button"
      accessibilityLabel={shareLabel}
      accessibilityHint={shareA11yHint}
      hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
      activeOpacity={0.86}
    >
      <Icon name="share-variant-outline" size={16} color="#FFFFFF" />
      <AppText
        variant="chip"
        tone="inverse"
        style={styles.text}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {shareLabel}
      </AppText>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.btn, saveBusy && styles.btnDisabled]}
      onPress={onSave}
      disabled={saveBusy}
      accessibilityRole="button"
      accessibilityLabel={saveLabel}
      accessibilityHint={saveA11yHint}
      hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
      activeOpacity={0.86}
    >
      <Icon name={saveBusy ? 'progress-clock' : 'content-save-outline'} size={16} color="#FFFFFF" />
      <AppText
        variant="chip"
        tone="inverse"
        style={styles.text}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {saveLabel}
      </AppText>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    minHeight: ThemeTokens.SecurityMap.buttonMinSize,
    flex: 1,
    minWidth: 0,
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.24)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  btnDisabled: {
    opacity: 0.68,
  },
  text: {
    flexShrink: 1,
  },
});

export default ShareSaveBar;
