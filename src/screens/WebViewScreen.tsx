import React, { useCallback, useRef, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, TouchableOpacity, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { ThemeTokens } from '../constants/ThemeTokens';
import { RootStackParamList } from '../navigation/types';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type Props = NativeStackScreenProps<RootStackParamList, 'WebView'>;

const WebViewScreen = ({ navigation, route }: Props) => {
  const [isLoading, setIsLoading] = useState(true);
  const { colors } = useTheme();
  const closingRef = useRef(false);
  const { url, title, intent } = route.params || { url: 'https://www.google.com' };

  const handleLoadEnd = () => {
    setIsLoading(false);
  };

  const extractPathname = useCallback((nextUrl: string) => {
    try {
      return new URL(nextUrl).pathname.toLowerCase();
    } catch {
      const normalized = String(nextUrl || '').trim();
      const withoutProtocol = normalized.replace(/^[a-z]+:\/\//i, '');
      const slashIndex = withoutProtocol.indexOf('/');
      const pathWithQuery = slashIndex >= 0 ? withoutProtocol.slice(slashIndex) : '/';
      return pathWithQuery.split(/[?#]/)[0].toLowerCase();
    }
  }, []);

  const resolveBillingSyncHint = useCallback(
    (nextUrl: string): 'checkout_success' | 'checkout_cancel' | 'portal_return' | null => {
      if (!intent) return null;
      const pathname = extractPathname(nextUrl);
      if (pathname === '/success') return 'checkout_success';
      if (pathname === '/cancel') return 'checkout_cancel';
      if (pathname === '/account/billing') return 'portal_return';
      return null;
    },
    [extractPathname, intent],
  );

  const handleBillingReturn = useCallback(
    (nextUrl: string) => {
      const hint = resolveBillingSyncHint(nextUrl);
      if (!hint || closingRef.current) {
        return false;
      }

      closingRef.current = true;
      navigation.navigate('Checkout', {
        billingSyncHint: hint,
        billingSyncNonce: Date.now(),
      });

      requestAnimationFrame(() => {
        navigation.goBack();
      });
      return true;
    },
    [navigation, resolveBillingSyncHint],
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBtn} activeOpacity={0.8}>
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]} numberOfLines={1}>
          {title || ''}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <WebView
        source={{ uri: url }}
        onLoadEnd={handleLoadEnd}
        onNavigationStateChange={navState => {
          setIsLoading(Boolean(navState.loading));
          handleBillingReturn(navState.url);
        }}
        onShouldStartLoadWithRequest={request => !handleBillingReturn(request.url)}
        originWhitelist={['https://*', 'http://*']}
      />

      {isLoading && (
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingTop: ThemeTokens.spacing.sm,
    paddingBottom: ThemeTokens.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headerTitle: {
    flex: 1,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.bold,
    fontFamily: FONT_FAMILY,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.92,
  },
});

export default WebViewScreen;
