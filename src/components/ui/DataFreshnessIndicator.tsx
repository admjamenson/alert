import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useBudgetStatus } from '../../context/BudgetStatusContext';
import AppText from './AppText';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTranslation } from 'react-i18next';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

/**
 * DATA FRESHNESS INDICATOR
 * Discrete banner shown when the application is serving cached data
 * due to cost containment or budget limits.
 */

export const DataFreshnessIndicator: React.FC = () => {
  const { isUsingCache } = useBudgetStatus();
  const { t } = useTranslation();

  if (!isUsingCache) return null;

  return (
    <View style={styles.container}>
      <Icon
        name="clock-outline"
        size={14}
        color={ThemeTokens.colors.light.riskMedium}
      />
      <AppText style={styles.text}>
        {t('legal_stale_data_notice')}
      </AppText>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: 'rgba(255, 204, 0, 0.12)',
    borderRadius: ThemeTokens.radius.sm,
    marginVertical: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: 'rgba(255, 204, 0, 0.2)',
  },
  text: {
    fontSize: 12,
    color: ThemeTokens.colors.light.riskMedium,
    marginLeft: 6,
    fontWeight: ThemeTokens.typography.weights.semibold,
  },
});
