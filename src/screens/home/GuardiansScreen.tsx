import React, { useState, useEffect } from 'react'; // S1128: 'useCallback' removed
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';
import { GuardianNetworkService } from '../../services/GuardianNetworkService';
import { useTranslation } from 'react-i18next';
import { AppModal } from '../../components/ui/AppModal';
import AppText from '../../components/ui/AppText';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { getTypographyStyle } from '../../theme/typography';

interface Guardian {
  id: string;
  name: string;
  phone: string;
  remoteId?: string;
}

const GuardiansScreen = ({ navigation }: any) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    loadGuardians();
  }, []);

  const loadGuardians = async () => {
    try {
      const stored = await AsyncStorage.getItem('@guardians_list');
      if (stored) {
        setGuardians(JSON.parse(stored));
      }
    } catch (e) {
      // Error handled with log and user feedback
      console.error('Error loading guardians from Storage:', e);
      Alert.alert(t('common_error'), t('guardians_error_load_body'));
    } finally {
      setLoading(false);
    }
  };

  const saveGuardians = async (newList: Guardian[]) => {
    try {
      await AsyncStorage.setItem('@guardians_list', JSON.stringify(newList));
      setGuardians(newList);
    } catch (e) {
      console.error('Erro ao salvar guardião:', e);
      Alert.alert(t('common_error'), t('guardians_error_save_body'));
    }
  };

  const handleAddGuardian = async () => {
    if (!newName.trim() || !newPhone.trim()) {
      Alert.alert(t('guardians_validation_title'), t('guardians_validation_body'));
      return;
    }

    const newGuardian: Guardian = {
      id: Date.now().toString(),
      name: newName,
      phone: newPhone,
    };

    const updatedList = [...guardians, newGuardian];
    await saveGuardians(updatedList);

    setNewName('');
    setNewPhone('');
    setModalVisible(false);

    const invite = await GuardianNetworkService.sendGuardianRequestByPhone(
      newPhone,
    );

    if (invite.status === 'ok' && invite.targetId) {
      const withRemote = updatedList.map(item =>
        item.id === newGuardian.id
          ? { ...item, remoteId: invite.targetId }
          : item,
      );
      await saveGuardians(withRemote);
      Alert.alert(t('guardians_invite_sent_title'), t('guardians_invite_sent_body'));
      return;
    }

    Alert.alert(t('guardians_invite_title'), t('guardians_invite_body'), [
      { text: t('common_not_now'), style: 'cancel' },
      {
        text: t('guardians_invite_now'),
        onPress: () => {
          Share.share({
            title: t('guardians_invite_subject'),
            message: t('guardians_invite_message'),
          });
        },
      },
    ]);
  };

  const handleDeleteGuardian = (id: string) => {
    Alert.alert(t('guardians_remove_title'), t('guardians_remove_body'), [
      { text: t('common_cancel'), style: 'cancel' },
      {
        text: t('common_remove'),
        style: 'destructive',
        onPress: () => {
          const updatedList = guardians.filter(item => item.id !== id);
          saveGuardians(updatedList);
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: Guardian }) => (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <View style={styles.cardIcon}>
        <Icon name="shield-account" size={24} color="#FF0000" />
      </View>
      <View style={styles.cardInfo}>
        <AppText variant="headline" tone="default" style={[styles.name, { color: colors.text }]}>
          {item.name}
        </AppText>
        <AppText variant="subhead" tone="secondary" style={[styles.phone, { color: colors.muted }]}>
          {item.phone}
        </AppText>
      </View>
      <TouchableOpacity
        onPress={() => handleDeleteGuardian(item.id)}
        style={styles.deleteBtn}
      >
        <Icon name="trash-can-outline" size={24} color="#FF0000" />
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={28} color={colors.text} />
        </TouchableOpacity>
        <AppText variant="title2" tone="default" style={[styles.title, { color: colors.text }]}>
          {t('network')}
        </AppText>
        <View style={{ width: 28 }} />
      </View>

      <AppText variant="subhead" tone="secondary" style={[styles.subtitle, { color: colors.muted }]}>
        {t('guardians_network_subtitle')}
      </AppText>

      {loading ? (
        <ActivityIndicator
          size="large"
          color="#FF0000"
          style={{ marginTop: 20 }}
        />
      ) : (
        <FlatList
          data={guardians}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Icon
                name="account-group-outline"
                size={60}
                color={colors.muted}
              />
              <AppText variant="body" tone="secondary" style={styles.emptyText}>
                {t('guardians_empty_network')}
              </AppText>
            </View>
          }
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() => setModalVisible(true)}
      >
        <Icon name="plus" size={30} color="#FFF" />
      </TouchableOpacity>

      <AppModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        title={t('guardians_modal_title')}
      >
        <TextInput
          placeholder={t('guardians_modal_name_placeholder')}
          placeholderTextColor={colors.muted}
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
          ]}
          value={newName}
          onChangeText={setNewName}
        />

        <TextInput
          placeholder={t('guardians_modal_phone_placeholder')}
          placeholderTextColor={colors.muted}
          keyboardType="phone-pad"
          style={[
            styles.input,
            { color: colors.text, borderColor: colors.border, backgroundColor: colors.background },
          ]}
          value={newPhone}
          onChangeText={setNewPhone}
        />

        <View style={styles.modalButtons}>
          <TouchableOpacity
            style={[styles.btn, styles.btnCancel]}
            onPress={() => setModalVisible(false)}
            activeOpacity={0.85}
          >
            <AppText variant="modalAction" tone="default" style={styles.btnTextCancel}>
              {t('common_cancel')}
            </AppText>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, styles.btnSave]}
            onPress={handleAddGuardian}
            activeOpacity={0.85}
          >
            <AppText variant="modalAction" tone="inverse" style={styles.btnTextSave}>
              {t('common_save')}
            </AppText>
          </TouchableOpacity>
        </View>
      </AppModal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
    marginTop: 10,
  },
  title: {},
  subtitle: { marginBottom: 20 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: ThemeTokens.spacing.lg,
    borderRadius: ThemeTokens.radius.md,
    marginBottom: ThemeTokens.spacing.sm,
    borderWidth: 1,
  },
  cardIcon: { marginRight: ThemeTokens.spacing.lg },
  cardInfo: { flex: 1 },
  name: {},
  phone: { marginTop: 2 },
  deleteBtn: { padding: ThemeTokens.spacing.xs },
  emptyContainer: { alignItems: 'center', marginTop: 50 },
  emptyText: { marginTop: 10, textAlign: 'center' },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#FF0000',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  input: {
    ...getTypographyStyle('input'),
    minHeight: 50,
    borderWidth: 1,
    borderRadius: ThemeTokens.radius.md,
    paddingHorizontal: 15,
    marginBottom: 15,
  },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 10 },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnCancel: { backgroundColor: '#EEE' },
  btnSave: { backgroundColor: '#FF0000' },
  btnTextCancel: { color: '#333' },
  btnTextSave: { color: '#FFF' },
});

export default GuardiansScreen;
