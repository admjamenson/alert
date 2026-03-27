import React, { useState } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';

// Alert palette
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const GRAY = '#666666';
const VIVID_RED = '#FF0000';
const LIGHT_GRAY = '#F8F8F8';
const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

const VerifyCodeScreen = ({ route, navigation }: any) => {
  const { t } = useTranslation();
  const { phoneNumber } = route.params || { phoneNumber: 'Test Mode' };

  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleVerify = () => {
    setLoading(true);
    setTimeout(() => {
      setLoading(false);
      navigation.navigate('ProfileSetup');
    }, 1000);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Icon name="chevron-left" size={32} color={BLACK} />
          </TouchableOpacity>

          <View style={styles.content}>
            <Text style={styles.title}>{t('auth_verify_number_title')}</Text>

            <Text style={styles.subtitle}>
              {t('auth_verify_code_subtitle', { phone: phoneNumber })}
            </Text>

            <TextInput
              style={styles.otpInput}
              placeholder={t('auth_code_placeholder')}
              placeholderTextColor="#BBB"
              keyboardType="number-pad"
              maxLength={6}
              value={code}
              onChangeText={text => setCode(text.replace(/\D/g, ''))}
              textAlign="center"
              autoFocus
              selectionColor={VIVID_RED}
            />

            <TouchableOpacity
              style={[
                styles.button,
                { backgroundColor: VIVID_RED },
              ]}
              onPress={handleVerify}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={WHITE} />
              ) : (
                <Text style={styles.buttonText}>{t('next')}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.resendButton}
              onPress={() => navigation.goBack()}
              disabled={loading}
            >
              <Text style={styles.resendText}>
                {t('auth_resend_prompt')}{' '}
                <Text style={styles.resendLink}>{t('auth_resend_action')}</Text>
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  scrollContent: { flexGrow: 1 },
  backButton: { padding: 20, marginLeft: 5 },
  content: { flex: 1, paddingHorizontal: 30, paddingTop: 10 },
  title: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
    color: BLACK,
    marginBottom: 10,
  },
  subtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    color: GRAY,
    marginBottom: 40,
  },
  otpInput: {
    height: 70,
    backgroundColor: LIGHT_GRAY,
    borderRadius: 15,
    fontFamily: FONT_FAMILY,
    fontSize: 28,
    fontWeight: ThemeTokens.typography.weights.bold,
    color: BLACK,
    marginBottom: 30,
    letterSpacing: 6,
    borderWidth: 1,
    borderColor: '#EEE',
  },
  button: {
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: BLACK,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  buttonText: {
    color: WHITE,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  resendButton: { marginTop: 25, alignItems: 'center' },
  resendText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
    color: GRAY,
  },
  resendLink: {
    color: VIVID_RED,
    fontWeight: ThemeTokens.typography.weights.bold,
  },
});

export default VerifyCodeScreen;
