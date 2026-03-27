/**
 * LOGIN SCREEN - Phone Number Authentication
 */

import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CountryCode } from 'react-native-country-picker-modal';
import { UserIdentityService } from '../../services/UserIdentityService';
import { useTranslation } from 'react-i18next';
import GlobalCountryPicker from '../../components/country/GlobalCountryPicker';
import CountryCatalogService from '../../services/CountryCatalogService';
import { ThemeTokens } from '../../constants/ThemeTokens';

const VIVID_RED = '#FF0000';
const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const LoginScreen = ({ navigation }: any) => {
  const { t } = useTranslation();
  const [countryCode, setCountryCode] = useState<CountryCode>('BR');
  const [callingCode, setCallingCode] = useState('55');
  const [countryFlag, setCountryFlag] = useState('🇧🇷');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [isPickerVisible, setIsPickerVisible] = useState(false);
  const [loading, setLoading] = useState(false);

  React.useEffect(() => {
    let mounted = true;
    const load = async () => {
      const saved = await CountryCatalogService.loadSelection();
      if (!mounted) return;
      setCountryCode(saved.countryCode);
      setCallingCode(saved.callingCode);

      const found = await CountryCatalogService.getCountryByCode(saved.countryCode, 'en');
      if (!mounted) return;
      if (found?.flag) setCountryFlag(found.flag);
    };
    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const onSelect = React.useCallback(
    (country: {
      cca2: string;
      callingCode: string;
      flag: string;
    }) => {
      const nextCode = (country.cca2 || 'BR') as CountryCode;
      const nextCalling = country.callingCode || '55';
      const nextFlag = country.flag || '🌐';

      setCountryCode(nextCode);
      setCallingCode(nextCalling);
      setCountryFlag(nextFlag);
      setIsPickerVisible(false);

      void CountryCatalogService.saveSelection(nextCode, nextCalling);
    },
    [],
  );

  const handleNext = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      const fullNumber = `+${callingCode}${phoneNumber}`;
      void UserIdentityService.setUserPhone(fullNumber);
      navigation.navigate('VerifyCode', {
        phoneNumber: fullNumber,
      });
    }, 500);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}
      >
        <View style={styles.content}>
          <Text style={styles.title}>{t('auth_verify_number_title')}</Text>

          <View style={styles.inputRow}>
            <TouchableOpacity
              onPress={() => setIsPickerVisible(true)}
              style={styles.countryBtn}
              activeOpacity={0.7}
            >
              <Text style={styles.flagText}>{countryFlag}</Text>
              <Text style={styles.ddi}>+{callingCode}</Text>
            </TouchableOpacity>

            <TextInput
              style={styles.input}
              keyboardType="phone-pad"
              value={phoneNumber}
              onChangeText={text => setPhoneNumber(text.replace(/\D/g, ''))}
              placeholder={t('auth_phone_input_placeholder')}
              placeholderTextColor="#CCC"
              maxLength={15}
            />
          </View>

          <TouchableOpacity
            style={[styles.btn, phoneNumber.length < 8 && styles.btnDisabled]}
            onPress={handleNext}
            disabled={phoneNumber.length < 8 || loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnText}>{t('next')}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <GlobalCountryPicker
        visible={isPickerVisible}
        selectedCountryCode={countryCode}
        onClose={() => setIsPickerVisible(false)}
        onSelect={onSelect}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFF' },
  flex: { flex: 1 },
  content: { flex: 1, padding: 30, justifyContent: 'center' },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
    color: '#000',
    marginBottom: 40,
    textAlign: 'center',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: VIVID_RED,
  },
  countryBtn: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10 },
  flagText: {
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    marginRight: 8,
  },
  ddi: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    color: '#000',
    marginRight: 15,
  },
  input: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    color: '#000',
    paddingBottom: 10,
  },
  btn: {
    backgroundColor: VIVID_RED,
    padding: 15,
    borderRadius: 30,
    marginTop: 40,
    alignItems: 'center',
    elevation: 2,
  },
  btnDisabled: { opacity: 0.5, elevation: 0 },
  btnText: {
    color: '#FFF',
    fontFamily: FONT_FAMILY,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default LoginScreen;
