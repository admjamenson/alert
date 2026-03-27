import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
  Platform,
  Alert,
  StatusBar,
  ActivityIndicator,
  Share,
} from 'react-native';
import Contacts from 'react-native-contacts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PermissionManager } from '../../utils/permissions';
import { useTranslation } from 'react-i18next';

const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const LIGHT_GRAY = '#F5F5F5';
const VIVID_RED = '#FF0000';

interface ContactItem {
  recordID: string;
  displayName: string;
  phone: string;
}

interface SetupContactsScreenProps {
  navigation: any;
}

const SetupContactsScreen = ({ navigation }: SetupContactsScreenProps) => {
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<ContactItem[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<ContactItem[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<ContactItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const requestAndLoadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const status = await PermissionManager.requestContactsPermission();

      if (status === 'blocked') {
        setLoading(false);
        Alert.alert(
          t('auth_permission_required_title'),
          t('auth_permission_required_body'),
          [
            { text: t('common_cancel'), style: 'cancel' },
            { text: t('common_open_settings'), onPress: PermissionManager.openSettings },
          ],
        );
        return;
      }

      if (status !== 'granted') {
        setLoading(false);
        Alert.alert(
          t('auth_access_required_title'),
          t('auth_access_required_body'),
          [
            { text: t('auth_exit'), onPress: () => navigation.goBack() },
            {
              text: t('common_try_again'),
              onPress: () => {
                requestAndLoadContacts();
              },
            },
          ],
        );
        return;
      }

      const rawContacts = await Contacts.getAll();
      const formatted: ContactItem[] = rawContacts
        .filter(c => c.phoneNumbers && c.phoneNumbers.length > 0)
        .map(c => ({
          recordID: c.recordID,
          displayName: c.displayName || t('auth_contact_no_name'),
          phone: c.phoneNumbers[0].number.replace(/\D/g, ''),
        }));

      formatted.sort((a, b) => a.displayName.localeCompare(b.displayName));
      setContacts(formatted);
      setFilteredContacts(formatted);
    } catch (err) {
      console.error('[SetupContacts] Error:', err);
    } finally {
      setLoading(false);
    }
  }, [navigation, t]);

  useEffect(() => {
    requestAndLoadContacts();
  }, [requestAndLoadContacts]);

  const handleSearch = (text: string) => {
    setSearch(text);
    const filtered = contacts.filter(
      c =>
        c.displayName.toLowerCase().includes(text.toLowerCase()) ||
        c.phone.includes(text),
    );
    setFilteredContacts(filtered);
  };

  const inviteFriend = (contact: ContactItem) => {
    const storeLink =
      Platform.OS === 'android'
        ? 'https://play.google.com/store/apps/details?id=com.alert.app'
        : 'https://apps.apple.com/app/id123456789';

    const message = t('auth_invite_message', {
      name: contact.displayName,
      link: storeLink,
    });

    Alert.alert(
      t('auth_invite_title'),
      t('auth_invite_body', { name: contact.displayName }),
      [
        { text: t('common_not_now'), style: 'cancel' },
        {
          text: t('auth_invite_now'),
          onPress: () => {
            Share.share({
              message,
              title: t('auth_invite_subject'),
            });
          },
        },
      ],
    );
  };

  const toggleContact = (contact: ContactItem) => {
    const isSelected = selectedContacts.find(
      c => c.recordID === contact.recordID,
    );

    if (isSelected) {
      setSelectedContacts(
        selectedContacts.filter(c => c.recordID !== contact.recordID),
      );
    } else {
      inviteFriend(contact);
      setSelectedContacts([...selectedContacts, contact]);
    }
  };

  const saveAndFinish = async () => {
    if (selectedContacts.length === 0) return;
    try {
      await AsyncStorage.setItem(
        '@emergency_contacts',
        JSON.stringify(selectedContacts),
      );
      navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
    } catch (error) {
      console.error('[SetupContacts] Error saving:', error);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="chevron-left" size={32} color={BLACK} />
        </TouchableOpacity>
        <View style={styles.headerTitleContainer}>
          <Text style={styles.title}>{t('auth_network_title')}</Text>
          <Text style={styles.subtitle}>{t('auth_network_subtitle')}</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBar}>
          <Icon name="magnify" size={22} color={GRAY} />
          <TextInput
            placeholder={t('common_search_placeholder')}
            placeholderTextColor={GRAY}
            style={styles.searchInput}
            value={search}
            onChangeText={handleSearch}
          />
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={VIVID_RED} />
        </View>
      ) : (
        <FlatList
          data={filteredContacts}
          keyExtractor={item => item.recordID}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isSelected = selectedContacts.some(
              c => c.recordID === item.recordID,
            );
            return (
              <TouchableOpacity
                style={[styles.contactCard, isSelected && styles.selectedCard]}
                onPress={() => toggleContact(item)}
              >
                <View
                  style={[
                    styles.avatar,
                    { backgroundColor: isSelected ? VIVID_RED : '#EEE' },
                  ]}
                >
                  <Text
                    style={[
                      styles.avatarText,
                      { color: isSelected ? WHITE : BLACK },
                    ]}
                  >
                    {item.displayName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.contactInfo}>
                  <Text style={styles.name}>{item.displayName}</Text>
                  <Text style={styles.phone}>{item.phone}</Text>
                </View>
                <Icon
                  name={isSelected ? 'check-circle' : 'account-plus-outline'}
                  size={26}
                  color={isSelected ? VIVID_RED : '#DDD'}
                />
              </TouchableOpacity>
            );
          }}
        />
      )}

      <View style={styles.footer}>
        <Text style={styles.countText}>
          {t('auth_selected_count', { count: selectedContacts.length })}
        </Text>
        <TouchableOpacity
          disabled={selectedContacts.length === 0}
          style={[
            styles.finishButton,
            {
              backgroundColor: selectedContacts.length > 0 ? VIVID_RED : '#CCC',
            },
          ]}
          onPress={saveAndFinish}
        >
          <Text style={styles.finishButtonText}>{t('auth_finish')}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  header: { flexDirection: 'row', alignItems: 'center', padding: 20 },
  headerTitleContainer: { marginLeft: 10 },
  title: { fontSize: 24, fontWeight: '900', color: BLACK },
  subtitle: { fontSize: 14, color: GRAY },
  searchContainer: { paddingHorizontal: 20, marginBottom: 15 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: LIGHT_GRAY,
    paddingHorizontal: 15,
    borderRadius: 15,
    height: 50,
  },
  searchInput: { flex: 1, marginLeft: 10, fontSize: 16, color: BLACK },
  listContent: { paddingHorizontal: 20, paddingBottom: 120 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  selectedCard: { borderBottomColor: VIVID_RED },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  avatarText: { fontWeight: 'bold', fontSize: 18 },
  contactInfo: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700', color: BLACK },
  phone: { fontSize: 13, color: GRAY },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  footer: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    backgroundColor: WHITE,
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#EEE',
  },
  countText: {
    textAlign: 'center',
    marginBottom: 10,
    fontWeight: '700',
    color: GRAY,
  },
  finishButton: {
    height: 55,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  finishButtonText: { color: WHITE, fontWeight: '900' },
});

export default SetupContactsScreen;
