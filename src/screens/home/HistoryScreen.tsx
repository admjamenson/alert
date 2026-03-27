import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { useTranslation } from 'react-i18next';

const MOCK_DATA = [
  {
    id: '1',
    date: '23/01/2026',
    time: '08:45',
    location: 'Av. Paulista, 1000',
    type: 'panic',
  },
  {
    id: '2',
    date: '21/01/2026',
    time: '19:20',
    location: 'Rua das Flores, 45',
    type: 'monitoring',
  },
];

export const HistoryScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const resolveType = (type: string) =>
    type === 'panic' ? t('history_type_panic') : t('history_type_monitoring');

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Icon name="arrow-left" size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: colors.text }]}>
          {t('history_title')}
        </Text>
      </View>

      <FlatList
        data={MOCK_DATA}
        keyExtractor={item => item.id}
        contentContainerStyle={{ padding: 20 }}
        renderItem={({ item }) => (
          <View
            style={[
              styles.card,
              { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardDate}>
                {t('history_date_time', { date: item.date, time: item.time })}
              </Text>
              <Text style={styles.cardType}>{resolveType(item.type)}</Text>
            </View>
            <View style={styles.locationRow}>
              <Icon name="map-marker" size={16} color="#FF0000" />
              <Text style={[styles.locationText, { color: colors.text }]}>
                {item.location}
              </Text>
            </View>
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 60,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  backBtn: { marginRight: 15 },
  title: { fontSize: 22, fontWeight: 'bold' },
  card: {
    padding: 15,
    borderRadius: 15,
    borderWidth: 1,
    marginBottom: 15,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardDate: { color: '#666', fontSize: 14 },
  cardType: { color: '#FF0000', fontWeight: 'bold', fontSize: 14 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  locationText: { fontSize: 15 },
});
