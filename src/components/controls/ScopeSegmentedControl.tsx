import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { ThemeTokens } from '../../constants/ThemeTokens';
import AppText from '../ui/AppText';

export type ScopeValue = 'CITY' | 'STATE' | 'COUNTRY';

type ScopeItem = {
  value: ScopeValue;
  label: string;
  icon: string;
};

type Props = {
  items: ScopeItem[];
  value: ScopeValue;
  onChange: (value: ScopeValue) => void;
  accessibilityHint?: string;
};

export const ScopeSegmentedControl: React.FC<Props> = ({
  items,
  value,
  onChange,
  accessibilityHint,
}) => (
  <View style={styles.row}>
    {items.map(item => {
      const selected = item.value === value;
      return (
        <TouchableOpacity
          key={item.value}
          style={[styles.btn, selected && styles.btnSelected]}
          onPress={() => onChange(item.value)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ selected }}
          hitSlop={ThemeTokens.SecurityMap.hitSlopDefault}
          activeOpacity={0.88}
        >
          <Icon
            name={item.icon}
            size={14}
            color={selected ? '#E3F2FD' : 'rgba(255,255,255,0.86)'}
          />
          <AppText
            variant="chip"
            tone={selected ? 'inverse' : 'inverseSecondary'}
            style={[styles.label, selected && styles.labelSelected]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.78}
          >
            {item.label}
          </AppText>
        </TouchableOpacity>
      );
    })}
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
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  btnSelected: {
    borderColor: 'rgba(66,165,245,0.82)',
    backgroundColor: 'rgba(66,165,245,0.26)',
  },
  label: {
    flexShrink: 1,
  },
  labelSelected: {},
});

export default ScopeSegmentedControl;
