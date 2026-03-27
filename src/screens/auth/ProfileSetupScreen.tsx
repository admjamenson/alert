import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useTheme } from '../../context/ThemeContext';
import { useTranslation } from 'react-i18next';

const ProfileSetupScreen = ({ navigation }: any) => {
  const [name, setName] = useState('');
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>
        {t('auth_profile_title')}
      </Text>
      <TextInput
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        placeholder={t('auth_profile_name_placeholder')}
        placeholderTextColor={colors.muted}
        value={name}
        onChangeText={setName}
      />
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.danger }]}
        onPress={() => navigation.navigate('SetupContacts')}
      >
        <Text style={styles.buttonText}>{t('next')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 30,
    backgroundColor: '#FFF',
    justifyContent: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
  },
  input: {
    borderBottomWidth: 1,
    borderColor: '#CCC',
    marginBottom: 40,
    padding: 10,
    fontSize: 18,
  },
  button: {
    backgroundColor: '#FF0000',
    height: 55,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonText: { color: '#FFF', fontWeight: 'bold' },
});

export default ProfileSetupScreen;
