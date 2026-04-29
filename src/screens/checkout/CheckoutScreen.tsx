import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTranslation } from 'react-i18next';
import { ThemeTokens } from '../../constants/ThemeTokens';
import { useTheme } from '../../context/ThemeContext';
import AlertLogo from '../../assets/logo.png';
import { CreatePremiumCheckoutSessionCommand } from '../../application/commands/CreatePremiumCheckoutSessionCommand';
import { CreatePremiumPortalSessionCommand } from '../../application/commands/CreatePremiumPortalSessionCommand';
import { CreatePremiumPaymentIntentCommand } from '../../application/commands/CreatePremiumPaymentIntentCommand';
import { ConfirmPremiumPaymentCommand } from '../../application/commands/ConfirmPremiumPaymentCommand';
import { ClearEntitlementCacheCommand } from '../../application/commands/ClearEntitlementCacheCommand';
import { GetPremiumBillingConfigQuery } from '../../application/queries/GetPremiumBillingConfigQuery';
import { GetPremiumBillingDiagnosticsQuery } from '../../application/queries/GetPremiumBillingDiagnosticsQuery';
import { GetPremiumBillingFallbackUrlQuery } from '../../application/queries/GetPremiumBillingFallbackUrlQuery';
import { GetPremiumBillingStateQuery } from '../../application/queries/GetPremiumBillingStateQuery';
import {
  getPremiumBillingErrorCategory,
  getPremiumBillingErrorCode,
  shouldOfferHostedBillingFallback,
} from '../../application/billing/PremiumBillingErrors';
import { BillingBrowserAdapter } from '../../infrastructure/adapters/BillingBrowserAdapter';
import { PaymentSheetAdapter } from '../../infrastructure/adapters/PaymentSheetAdapter';
import { resolveBillingProvider } from '../../billing/BillingProvider';
import type {
  PremiumBillingAccount,
  PremiumInvoice,
  PremiumPaymentMethod,
} from '../../domain/billing/PremiumBillingAccount';
import type { PremiumBillingConfig } from '../../domain/billing/PremiumBillingConfig';
import type { RootStackParamList } from '../../navigation/types';

const FONT_FAMILY =
  Platform.OS === 'ios'
    ? ThemeTokens.typography.families.ios
    : ThemeTokens.typography.families.android;

type CheckoutNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  'Checkout'
>;

const CheckoutScreen: React.FC<{ navigation: CheckoutNavigationProp }> = ({
  navigation,
}) => {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const route = useRoute<RouteProp<RootStackParamList, 'Checkout'>>();
  const billingContext = useMemo(() => resolveBillingProvider(), []);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<'checkout' | 'portal' | null>(
    null,
  );
  const [billingAccount, setBillingAccount] =
    useState<PremiumBillingAccount | null>(null);
  const [billingConfig, setBillingConfig] =
    useState<PremiumBillingConfig | null>(null);
  const [isPremium, setIsPremium] = useState(false);
  const [error, setError] = useState('');
  const lastHandledBillingSyncNonceRef = useRef<number | null>(null);
  const pendingBillingIntentRef = useRef<
    'checkout' | 'portal' | 'document' | null
  >(null);
  const pendingPaymentConfirmationRef = useRef<{
    paymentIntentId: string;
    subscriptionId?: string | null;
  } | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const readBillingState = useCallback(async () => {
    const state = await GetPremiumBillingStateQuery.execute({
      forceRefresh: true,
    });

    setBillingAccount(state.account);
    setIsPremium(state.premium);
    setError('');
    return {
      account: state.account,
      premium: state.premium,
      hasOperationalBillingState: state.hasOperationalBillingState,
    };
  }, []);

  const readBillingConfig = useCallback(async () => {
    const config = await GetPremiumBillingConfigQuery.execute();
    setBillingConfig(config);
    return config;
  }, []);

  const confirmPremiumPayment = useCallback(
    async (options: { paymentIntentId: string; subscriptionId?: string | null }) => {
      let lastResult: Awaited<
        ReturnType<typeof ConfirmPremiumPaymentCommand.execute>
      > | null = null;

      for (let attempt = 0; attempt < 3; attempt += 1) {
        lastResult = await ConfirmPremiumPaymentCommand.execute(options);
        if (lastResult.premiumActive || lastResult.paymentIntentStatus === 'succeeded') {
          return lastResult;
        }
        if (attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      return lastResult;
    },
    [],
  );

  const loadBillingState = useCallback(
    async (
      mode:
        | 'initial'
        | 'focus'
        | 'checkout_success'
        | 'checkout_cancel'
        | 'portal_return' = 'focus',
    ) => {
      const attempts = mode === 'checkout_success' ? 5 : 1;

      if (mode === 'initial') {
        setLoading(true);
      } else {
        setRefreshing(true);
      }

      try {
        const billingConfigPromise = readBillingConfig().catch(() => null);
        let lastResult: {
          account: PremiumBillingAccount | null;
          premium: boolean;
          hasOperationalBillingState: boolean;
        } | null = null;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          lastResult = await readBillingState();
          if (mode !== 'checkout_success' || lastResult.premium) {
            break;
          }

          await ClearEntitlementCacheCommand.execute();
          await new Promise(resolve => setTimeout(resolve, 1200));
        }

        await billingConfigPromise;
        return lastResult;
      } catch {
        setError('');
        return null;
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [readBillingConfig, readBillingState, t],
  );

  useEffect(() => {
    void loadBillingState('initial');
  }, [loadBillingState]);

  useEffect(() => {
    const unsubscribe = navigation.addListener?.('focus', () => {
      const billingSyncNonce = route.params?.billingSyncNonce;
      const billingSyncHint = route.params?.billingSyncHint;

      if (
        typeof billingSyncNonce === 'number' &&
        billingSyncNonce !== lastHandledBillingSyncNonceRef.current
      ) {
        lastHandledBillingSyncNonceRef.current = billingSyncNonce;
        void ClearEntitlementCacheCommand.execute().finally(() => {
          void loadBillingState(billingSyncHint || 'focus').finally(() => {
            navigation.setParams({
              billingSyncHint: undefined,
              billingSyncNonce: undefined,
            });
          });
        });
        return;
      }

      void ClearEntitlementCacheCommand.execute().finally(() => {
        void loadBillingState('focus');
      });
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [
    loadBillingState,
    navigation,
    route.params?.billingSyncHint,
    route.params?.billingSyncNonce,
  ]);

  useEffect(() => {
    const handleBillingReturn = () => {
      const intent = pendingBillingIntentRef.current;
      if (!intent) {
        return;
      }

      pendingBillingIntentRef.current = null;
      const syncMode =
        intent === 'checkout' ? 'checkout_success' : 'portal_return';
      const pendingPayment = pendingPaymentConfirmationRef.current;
      void (async () => {
        try {
          if (intent === 'checkout' && pendingPayment) {
            await confirmPremiumPayment(pendingPayment);
          }
        } catch {
          // refresh below still re-checks canonical backend state
        } finally {
          pendingPaymentConfirmationRef.current = null;
          await ClearEntitlementCacheCommand.execute();
          await loadBillingState(syncMode);
        }
      })();
    };

    const appStateSubscription = AppState.addEventListener(
      'change',
      nextState => {
        const previousState = appStateRef.current;
        appStateRef.current = nextState;
        const returnedToForeground =
          (previousState === 'background' || previousState === 'inactive') &&
          nextState === 'active';

        if (returnedToForeground) {
          handleBillingReturn();
        }
      },
    );

    const removeDismissListener =
      BillingBrowserAdapter.addDismissListener(handleBillingReturn);

    return () => {
      appStateSubscription.remove();
      removeDismissListener();
    };
  }, [loadBillingState]);

  const status =
    billingAccount?.billing?.subscription_status ||
    (isPremium ? 'active' : 'inactive');

  const statusLabel = useMemo(() => {
    const labels: Record<string, string> = {
      active: t('premium_status_active'),
      trialing: t('premium_status_trialing'),
      past_due: t('premium_status_past_due'),
      unpaid: t('premium_status_unpaid'),
      canceled: t('premium_status_canceled'),
      incomplete: t('premium_status_incomplete'),
      inactive: t('premium_status_inactive'),
    };
    return labels[String(status)] || t('premium_status_unknown');
  }, [status, t]);

  const statusTone = useMemo(() => {
    const normalized = String(status).toLowerCase();
    if (normalized === 'active' || normalized === 'trialing') {
      return {
        backgroundColor: colors.riskLow + '18',
        color: colors.riskLow,
      };
    }
    if (normalized === 'past_due' || normalized === 'unpaid') {
      return {
        backgroundColor: colors.riskMedium + '18',
        color: colors.riskMedium,
      };
    }
    return {
      backgroundColor: colors.border,
      color: colors.textSecondary,
    };
  }, [
    colors.border,
    colors.riskLow,
    colors.riskMedium,
    colors.textSecondary,
    status,
  ]);

  const marketingHighlights = useMemo(
    () => [
      t('premium_highlight_ai'),
      t('premium_highlight_maps'),
      t('premium_highlight_context'),
    ],
    [t],
  );

  const premiumBenefitSections = useMemo(
    () => [
      {
        title: t('premium_group_response'),
        items: [
          {
            icon: 'shield-alert-outline',
            title: t('premium_benefit_sos_title'),
            body: t('premium_benefit_sos_body'),
          },
          {
            icon: 'map-marker-account-outline',
            title: t('premium_benefit_location_title'),
            body: t('premium_benefit_location_body'),
          },
          {
            icon: 'car-emergency',
            title: t('premium_benefit_collision_title'),
            body: t('premium_benefit_collision_body'),
          },
          {
            icon: 'gesture-tap-button',
            title: t('premium_benefit_quick_settings_title'),
            body: t('premium_benefit_quick_settings_body'),
          },
          {
            icon: 'run-fast',
            title: t('premium_benefit_response_title'),
            body: t('premium_benefit_response_body'),
          },
        ],
      },
      {
        title: t('premium_group_monitoring'),
        items: [
          {
            icon: 'robot-outline',
            title: t('premium_benefit_ai_title'),
            body: t('premium_benefit_ai_body'),
          },
          {
            icon: 'map-search-outline',
            title: t('premium_benefit_maps_title'),
            body: t('premium_benefit_maps_body'),
          },
          {
            icon: 'view-grid-outline',
            title: t('premium_benefit_widgets_title'),
            body: t('premium_benefit_widgets_body'),
          },
          {
            icon: 'bell-ring-outline',
            title: t('premium_benefit_notifications_title'),
            body: t('premium_benefit_notifications_body'),
          },
          {
            icon: 'radar',
            title: t('premium_benefit_monitoring_title'),
            body: t('premium_benefit_monitoring_body'),
          },
          {
            icon: 'crosshairs-gps',
            title: t('premium_benefit_context_title'),
            body: t('premium_benefit_context_body'),
          },
        ],
      },
      {
        title: t('premium_group_experience'),
        items: [
          {
            icon: 'gesture-tap-hold',
            title: t('premium_benefit_interface_title'),
            body: t('premium_benefit_interface_body'),
          },
        ],
      },
    ],
    [t],
  );

  const formatDate = useCallback(
    (value?: string | null) => {
      if (!value) return t('premium_value_unavailable');
      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return t('premium_value_unavailable');
      return new Intl.DateTimeFormat(undefined, {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(parsed);
    },
    [t],
  );

  const formatCurrency = useCallback(
    (invoice: PremiumInvoice) => {
      if (!invoice.currency || typeof invoice.amountPaid !== 'number') {
        return t('premium_value_unavailable');
      }

      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: invoice.currency,
      }).format(invoice.amountPaid / 100);
    },
    [t],
  );

  const formatPaymentMethod = useCallback(
    (paymentMethod?: PremiumPaymentMethod | null) => {
      if (!paymentMethod?.brand || !paymentMethod?.last4) {
        return t('premium_payment_method_unavailable');
      }

      const expiry =
        paymentMethod.expMonth && paymentMethod.expYear
          ? ` - ${String(paymentMethod.expMonth).padStart(2, '0')}/${String(
              paymentMethod.expYear,
            ).slice(-2)}`
          : '';
      return t('premium_payment_method_format', {
        brand: paymentMethod.brand.toUpperCase(),
        last4: paymentMethod.last4,
        expiry,
      });
    },
    [t],
  );

  const formatOfferPrice = useCallback(
    (config?: PremiumBillingConfig | null) => {
      const offer = config?.offer;
      if (!offer?.available) {
        return t('premium_value_unavailable');
      }
      if (!offer.currency || typeof offer.unitAmount !== 'number') {
        return t('premium_value_unavailable');
      }

      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: offer.currency,
      }).format(offer.unitAmount / 100);
    },
    [t],
  );

  const formatOfferPeriod = useCallback(
    (config?: PremiumBillingConfig | null) => {
      const offer = config?.offer;
      const interval = offer?.interval;
      if (!offer?.available || !interval) {
        return '';
      }

      const intervalLabel =
        interval === 'day'
          ? t('premium_interval_day')
          : interval === 'week'
          ? t('premium_interval_week')
          : interval === 'year'
          ? t('premium_interval_year')
          : t('premium_interval_month');

      const intervalCount =
        typeof offer.intervalCount === 'number' && offer.intervalCount > 1
          ? offer.intervalCount
          : 1;

      if (intervalCount === 1) {
        return `/${intervalLabel}`;
      }

      return t('premium_interval_every_count', {
        count: intervalCount,
        interval: intervalLabel,
      });
    },
    [t],
  );

  const checkoutEnabled = useMemo(
    () => isPremium || Boolean(billingConfig?.offer?.available),
    [billingConfig?.offer?.available, isPremium],
  );

  const openBillingSurface = useCallback(
    async (url: string, intent: 'checkout' | 'portal' | 'document') => {
      pendingBillingIntentRef.current = intent === 'document' ? null : intent;
      try {
        await BillingBrowserAdapter.open(url);
      } catch (error) {
        if (intent !== 'document') {
          pendingBillingIntentRef.current = null;
        }
        throw error;
      }
    },
    [],
  );

  const mapBillingErrorMessage = useCallback(
    (error: unknown, intent: 'checkout' | 'portal') => {
      const category = getPremiumBillingErrorCategory(error);

      if (category === 'identity') {
        return t(
          intent === 'checkout'
            ? 'premium_error_checkout_identity'
            : 'premium_error_portal_identity',
        );
      }

      if (category === 'service') {
        return t(
          intent === 'checkout'
            ? 'premium_error_checkout_service'
            : 'premium_error_portal_service',
        );
      }

      return t(
        intent === 'checkout'
          ? 'premium_error_checkout'
          : 'premium_error_portal',
      );
    },
    [t],
  );

  const openCheckoutUrl = useCallback(
    async (url: string) => {
      try {
        navigation.navigate('WebView', {
          url,
          title: t('premium_checkout_webview_title'),
          intent: 'billing_checkout',
        });
      } catch {
        try {
          pendingBillingIntentRef.current = 'checkout';
          await BillingBrowserAdapter.open(url);
        } catch {
          pendingBillingIntentRef.current = null;
          const canOpen = await Linking.canOpenURL(url);
          if (canOpen) await Linking.openURL(url);
        }
      }
    },
    [navigation, t],
  );

  const openDocumentUrl = useCallback(
    async (url: string) => {
      try {
        await openBillingSurface(url, 'document');
      } catch {
        const canOpen = await Linking.canOpenURL(url);
        if (canOpen) await Linking.openURL(url);
      }
    },
    [openBillingSurface],
  );

  const handleNativeStripeCheckout = useCallback(async () => {
    const paymentSheetSession =
      await CreatePremiumPaymentIntentCommand.execute();
    if (__DEV__) {
      console.log('[premium/checkout/payment-sheet]', {
        baseUrl: GetPremiumBillingDiagnosticsQuery.execute().baseUrl,
        hasPublishableKey: Boolean(paymentSheetSession.publishableKey),
        hasCustomerId: Boolean(paymentSheetSession.customerId),
        hasEphemeralKey: Boolean(
          paymentSheetSession.customerEphemeralKeySecret,
        ),
        hasClientSecret: Boolean(
          paymentSheetSession.paymentIntentClientSecret,
        ),
        hasReturnUrl: Boolean(paymentSheetSession.returnURL),
      });
    }
    pendingBillingIntentRef.current = 'checkout';
    pendingPaymentConfirmationRef.current = {
      paymentIntentId: paymentSheetSession.paymentIntentId,
      subscriptionId: paymentSheetSession.subscriptionId,
    };
    const initResult = await PaymentSheetAdapter.initPaymentSheet({
      publishableKey: paymentSheetSession.publishableKey,
      customerId: paymentSheetSession.customerId,
      customerEphemeralKeySecret:
        paymentSheetSession.customerEphemeralKeySecret,
      paymentIntentClientSecret:
        paymentSheetSession.paymentIntentClientSecret,
      merchantDisplayName: t('settings_alert_premium'),
      merchantCountryCode: paymentSheetSession.merchantCountryCode,
      currencyCode: paymentSheetSession.currencyCode,
      returnURL: paymentSheetSession.returnURL,
      enableGooglePay: false,
      allowsDelayedPaymentMethods: false,
    });

    if (initResult.canceled) {
      pendingPaymentConfirmationRef.current = null;
      pendingBillingIntentRef.current = null;
      throw new Error('premium_error_payment_canceled');
    }

    if (initResult.error) {
      pendingPaymentConfirmationRef.current = null;
      pendingBillingIntentRef.current = null;
      throw new Error(
        String(initResult.error.code || 'stripe_payment_sheet_init_failed'),
      );
    }

    const presentResult = await PaymentSheetAdapter.presentPaymentSheet();
    if (presentResult.canceled) {
      pendingPaymentConfirmationRef.current = null;
      pendingBillingIntentRef.current = null;
      throw new Error('premium_error_payment_canceled');
    }

    if (presentResult.error) {
      pendingPaymentConfirmationRef.current = null;
      pendingBillingIntentRef.current = null;
      throw new Error(
        String(
          presentResult.error.code || 'stripe_payment_sheet_present_failed',
        ),
      );
    }

    let confirmation = null;
    try {
      confirmation = await confirmPremiumPayment({
        paymentIntentId: paymentSheetSession.paymentIntentId,
        subscriptionId: paymentSheetSession.subscriptionId,
      });
    } finally {
      pendingPaymentConfirmationRef.current = null;
      pendingBillingIntentRef.current = null;
    }
    await ClearEntitlementCacheCommand.execute();
    const state = await loadBillingState('checkout_success');
    const premiumActive = Boolean(confirmation?.premiumActive || state?.premium);

    if (premiumActive) {
      Alert.alert(t('checkout_success_title'), t('checkout_success_body'));
      return;
    }

    Alert.alert(
      t('checkout_success_title'),
      t('premium_payment_pending_body', {
        defaultValue:
          'Seu pagamento foi recebido e o Premium está sendo ativado. Atualize esta tela em alguns instantes.',
      }),
    );
  }, [confirmPremiumPayment, loadBillingState, t]);

  const handleHostedCheckout = useCallback(async () => {
    const session = await CreatePremiumCheckoutSessionCommand.execute();
    await openCheckoutUrl(String(session?.url || ''));
  }, [openCheckoutUrl]);

  const handleOpenCheckout = useCallback(async () => {
    if (!checkoutEnabled) {
      const message = t('premium_error_checkout_service');
      setError(message);
      Alert.alert(t('premium_error_title'), message);
      return;
    }

    try {
      setBusyAction('checkout');
      setError('');
      if (__DEV__) {
        console.log('[premium/checkout/start]', {
          provider: billingContext.provider,
          platform: Platform.OS,
          baseUrl: GetPremiumBillingDiagnosticsQuery.execute().baseUrl,
        });
      }
      if (Platform.OS === 'android' && billingContext.provider === 'stripe') {
        await handleNativeStripeCheckout();
        setBusyAction(null);
        return;
      }

      try {
        await handleHostedCheckout();
      } catch (hostedError) {
        const hostedCode = getPremiumBillingErrorCode(hostedError);
        if (hostedCode !== 'premium_error_payment_canceled') {
          console.error('[premium/checkout/hosted]', hostedCode);
        }
        throw hostedError;
      }
    } catch (error) {
      const code = getPremiumBillingErrorCode(error);
      if (code !== 'premium_error_payment_canceled') {
        console.error('[premium/checkout]', code);
      }

      if (code === 'premium_error_payment_canceled') {
        setError('');
        setBusyAction(null);
        return;
      }

      const message = mapBillingErrorMessage(error, 'checkout');
      setError(message);
      setBusyAction(null);

      const fallbackUrl =
        !shouldOfferHostedBillingFallback(error)
          ? null
          : await GetPremiumBillingFallbackUrlQuery.checkout();
      if (fallbackUrl) {
        Alert.alert(t('premium_error_title'), message, [
          { text: t('common_cancel') || 'Cancelar', style: 'cancel' },
          {
            text:
              t('premium_open_checkout_page') || 'Abrir página de assinatura',
            onPress: () => {
              void openCheckoutUrl(fallbackUrl);
            },
          },
        ]);
        return;
      }

      Alert.alert(t('premium_error_title'), message);
    }
  }, [
    billingContext.provider,
    checkoutEnabled,
    handleHostedCheckout,
    handleNativeStripeCheckout,
    mapBillingErrorMessage,
    openCheckoutUrl,
    t,
  ]);

  const handleOpenPortal = useCallback(async () => {
    if (billingContext.provider === 'app_store') {
      Alert.alert(
        t('premium_error_title'),
        t('premium_ios_storekit_coming_soon', {
          defaultValue:
            'Gerenciamento de assinatura pelo App Store. VocÃª pode gerenciar suas compras nas ConfiguraÃ§Ãµes do seu iPhone > [Seu Nome] > iTunes e App Store > Apple ID > Assinaturas.',
        }),
      );
      return;
    }
    let portal: { url: string } | null = null;
    try {
      setBusyAction('portal');
      setError('');
      portal = await CreatePremiumPortalSessionCommand.execute();
    } catch (portalError) {
      const code = getPremiumBillingErrorCode(portalError);
      console.error('[premium/portal/session]', code);
      const message = mapBillingErrorMessage(portalError, 'portal');
      setError(message);
      setBusyAction(null);

      const fallbackUrl = await GetPremiumBillingFallbackUrlQuery.portal();
      if (fallbackUrl) {
        Alert.alert(t('premium_error_title'), message, [
          { text: t('common_cancel') || 'Cancelar', style: 'cancel' },
          {
            text: t('premium_open_portal_page') || 'Abrir pÃ¡gina de cobranÃ§a',
            onPress: () => openCheckoutUrl(fallbackUrl),
          },
        ]);
      } else {
        Alert.alert(t('premium_error_title'), message);
      }
      return;
    }

    try {
      await openBillingSurface(String(portal?.url || ''), 'portal');
    } catch (openError) {
      console.error(
        '[premium/portal/open]',
        getPremiumBillingErrorCode(openError),
      );
      const message = mapBillingErrorMessage(openError, 'portal');
      setError(message);

      const fallbackUrl = await GetPremiumBillingFallbackUrlQuery.portal();
      if (fallbackUrl) {
        Alert.alert(t('premium_error_title'), message, [
          { text: t('common_cancel') || 'Cancelar', style: 'cancel' },
          {
            text: t('premium_open_portal_page') || 'Abrir pÃ¡gina de cobranÃ§a',
            onPress: () => openCheckoutUrl(fallbackUrl),
          },
        ]);
      } else {
        Alert.alert(t('premium_error_title'), message);
      }
    } finally {
      setBusyAction(null);
    }
  }, [
    billingContext.provider,
    mapBillingErrorMessage,
    openBillingSurface,
    openCheckoutUrl,
    t,
  ]);

  const invoices = billingAccount?.invoices || [];

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerButton}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('common_back') || t('settings_alert_premium')}
        >
          <Icon name="arrow-left" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>
          {t('settings_alert_premium')}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              void ClearEntitlementCacheCommand.execute().finally(() => {
                void loadBillingState('focus');
              });
            }}
            tintColor={colors.primary}
            colors={[colors.primary]}
            progressBackgroundColor={colors.background}
          />
        }
      >
        <View
          style={[
            styles.heroCard,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.heroTopRow}>
            <View style={styles.heroIdentity}>
              <View
                style={[
                  styles.logoWrap,
                  { backgroundColor: colors.background },
                ]}
              >
                <Image
                  source={AlertLogo}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <View style={styles.heroTextWrap}>
                <Text style={[styles.heroTitle, { color: colors.text }]}>
                  {t('settings_alert_premium')}
                </Text>
                <Text
                  style={[styles.heroSubtitle, { color: colors.textSecondary }]}
                >
                  {isPremium
                    ? t('premium_subtitle_active')
                    : t('premium_subtitle_free')}
                </Text>
              </View>
            </View>
            <View style={[styles.statusPill, statusTone]}>
              <Text
                style={[styles.statusPillText, { color: statusTone.color }]}
              >
                {statusLabel}
              </Text>
            </View>
          </View>

          <Text
            style={[styles.heroDescription, { color: colors.textSecondary }]}
          >
            {t('premium_description')}
          </Text>

          <View style={styles.heroActions}>
            <TouchableOpacity
              style={[
                styles.primaryButton,
                { backgroundColor: colors.primary },
                busyAction === 'checkout' && styles.disabledButton,
                busyAction === 'portal' && styles.disabledButton,
              ]}
              onPress={isPremium ? handleOpenPortal : handleOpenCheckout}
              disabled={busyAction !== null || (!isPremium && !checkoutEnabled)}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel={
                isPremium ? t('premium_manage_cta') : t('premium_subscribe_cta')
              }
              accessibilityState={{
                busy: busyAction !== null,
                disabled:
                  busyAction !== null || (!isPremium && !checkoutEnabled),
              }}
            >
              {busyAction === 'checkout' || busyAction === 'portal' ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryButtonText}>
                  {isPremium
                    ? t('premium_manage_cta')
                    : t('premium_subscribe_cta')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {error ? (
          <View
            style={[
              styles.infoCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text style={[styles.errorText, { color: colors.alert }]}>
              {error}
            </Text>
          </View>
        ) : null}

        {loading ? (
          <View
            style={[
              styles.loadingCard,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <>
            {!isPremium ? (
              <>
                <View
                  style={[
                    styles.marketingCard,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                  ]}
                >
                  <View style={styles.marketingTopRow}>
                    <View
                      style={[
                        styles.marketingBadge,
                        { backgroundColor: 'rgba(255,255,255,0.16)' },
                      ]}
                    >
                    <Text style={styles.marketingBadgeText}>
                        {t('premium_marketing_badge')}
                      </Text>
                    </View>
                    <Text style={styles.marketingPlanLabel}>
                      {billingConfig?.offer?.productName || t('checkout_plan_label')}
                    </Text>
                  </View>

                  <Text style={styles.marketingTitle}>
                    {t('premium_marketing_title')}
                  </Text>
                  <Text style={styles.marketingSubtitle}>
                    {t('premium_marketing_subtitle')}
                  </Text>

                  <View style={styles.highlightRow}>
                    {marketingHighlights.map(item => (
                      <View key={item} style={styles.highlightChip}>
                        <Text style={styles.highlightChipText}>{item}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={styles.priceRow}>
                    <Text style={styles.priceValue}>
                      {formatOfferPrice(billingConfig)}
                    </Text>
                    <Text style={styles.pricePeriod}>
                      {formatOfferPeriod(billingConfig)}
                    </Text>
                  </View>

                  <Text style={styles.marketingCaption}>
                    {t('premium_marketing_caption')}
                  </Text>
                </View>

                {premiumBenefitSections.map(section => (
                  <View
                    key={section.title}
                    style={[
                      styles.infoCard,
                      {
                        backgroundColor: colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>
                      {section.title}
                    </Text>
                    {section.items.map(item => (
                      <View key={item.title} style={styles.benefitRow}>
                        <View
                          style={[
                            styles.benefitIconWrap,
                            {
                              backgroundColor: colors.background,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Icon
                            name={item.icon}
                            size={18}
                            color={colors.primary}
                          />
                        </View>
                        <View style={styles.benefitTextWrap}>
                          <Text
                            style={[
                              styles.benefitTitle,
                              { color: colors.text },
                            ]}
                          >
                            {item.title}
                          </Text>
                          <Text
                            style={[
                              styles.benefitBody,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {item.body}
                          </Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ))}
              </>
            ) : (
              <>
                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {t('premium_section_account')}
                  </Text>
                  <View style={styles.definitionGrid}>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_plan')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {t('settings_alert_premium')}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_status')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {statusLabel}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_period_end')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {formatDate(
                          billingAccount?.billing?.current_period_end,
                        )}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_currency')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {billingAccount?.billing?.billing_currency ||
                          t('premium_value_unavailable')}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_country')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {billingAccount?.billing?.billing_country_code ||
                          t('premium_value_unavailable')}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_city')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                      >
                        {billingAccount?.billing?.billing_city_name ||
                          t('premium_value_unavailable')}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_customer')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {billingAccount?.billing?.stripe_customer_id ||
                          t('premium_value_unavailable')}
                      </Text>
                    </View>
                    <View style={styles.definitionItem}>
                      <Text
                        style={[
                          styles.definitionLabel,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {t('premium_field_subscription')}
                      </Text>
                      <Text
                        style={[styles.definitionValue, { color: colors.text }]}
                        numberOfLines={1}
                      >
                        {billingAccount?.billing?.stripe_subscription_id ||
                          t('premium_value_unavailable')}
                      </Text>
                    </View>
                  </View>
                </View>

                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {t('premium_section_billing')}
                  </Text>
                  <View style={styles.billingRow}>
                    <Icon
                      name="credit-card-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <Text
                      style={[styles.billingRowText, { color: colors.text }]}
                    >
                      {formatPaymentMethod(billingAccount?.paymentMethod)}
                    </Text>
                  </View>
                  <View style={styles.billingRow}>
                    <Icon
                      name="email-outline"
                      size={20}
                      color={colors.primary}
                    />
                    <Text
                      style={[styles.billingRowText, { color: colors.text }]}
                    >
                      {billingAccount?.customer?.email ||
                        t('premium_value_unavailable')}
                    </Text>
                  </View>
                </View>

                <View
                  style={[
                    styles.infoCard,
                    {
                      backgroundColor: colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {t('premium_receipts_title')}
                  </Text>
                  {invoices.length > 0 ? (
                    invoices.map(invoice => (
                      <View
                        key={invoice.id}
                        style={[
                          styles.invoiceRow,
                          { borderTopColor: colors.border },
                        ]}
                      >
                        <View style={styles.invoiceInfo}>
                          <Text
                            style={[
                              styles.invoiceTitle,
                              { color: colors.text },
                            ]}
                          >
                            {invoice.number ||
                              t('premium_invoice_default_title')}
                          </Text>
                          <Text
                            style={[
                              styles.invoiceMeta,
                              { color: colors.textSecondary },
                            ]}
                          >
                            {formatDate(invoice.createdAt)} -{' '}
                            {formatCurrency(invoice)}
                          </Text>
                        </View>
                        <View style={styles.invoiceActions}>
                          {invoice.hostedInvoiceUrl ? (
                            <TouchableOpacity
                              style={[
                                styles.invoiceActionPill,
                                {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                },
                              ]}
                              onPress={() =>
                                void openDocumentUrl(
                                  invoice.hostedInvoiceUrl as string,
                                )
                              }
                              accessibilityRole="button"
                              accessibilityLabel={t('premium_receipt_open')}
                            >
                              <Text
                                style={[
                                  styles.invoiceActionText,
                                  { color: colors.text },
                                ]}
                              >
                                {t('premium_receipt_open')}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          {invoice.invoicePdf ? (
                            <TouchableOpacity
                              style={[
                                styles.invoiceActionPill,
                                {
                                  backgroundColor: colors.background,
                                  borderColor: colors.border,
                                },
                              ]}
                              onPress={() =>
                                void openDocumentUrl(
                                  invoice.invoicePdf as string,
                                )
                              }
                              accessibilityRole="button"
                              accessibilityLabel={t('premium_receipt_pdf')}
                            >
                              <Text
                                style={[
                                  styles.invoiceActionText,
                                  { color: colors.text },
                                ]}
                              >
                                {t('premium_receipt_pdf')}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text
                      style={[
                        styles.emptyText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {t('premium_receipts_empty')}
                    </Text>
                  )}
                </View>
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: ThemeTokens.spacing.lg,
    paddingVertical: ThemeTokens.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
  },
  content: {
    padding: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.md,
  },
  heroCard: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    padding: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.md,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: ThemeTokens.spacing.md,
  },
  heroIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: ThemeTokens.spacing.md,
  },
  logoWrap: {
    width: 64,
    height: 64,
    borderRadius: ThemeTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoImage: {
    width: 38,
    height: 38,
  },
  heroTextWrap: {
    flex: 1,
    gap: 2,
  },
  heroTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.title,
    lineHeight: ThemeTokens.typography.lineHeights.title,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.title,
  },
  heroSubtitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
    fontWeight: ThemeTokens.typography.weights.medium,
  },
  heroDescription: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  statusPill: {
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: 6,
  },
  statusPillText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  heroActions: {
    flexDirection: 'column',
    gap: ThemeTokens.spacing.sm,
  },
  marketingCard: {
    borderRadius: ThemeTokens.radius.xl,
    borderWidth: 1,
    padding: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.md,
  },
  marketingTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: ThemeTokens.spacing.sm,
  },
  marketingBadge: {
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: 6,
  },
  marketingBadgeText: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  marketingPlanLabel: {
    color: 'rgba(255,255,255,0.84)',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  marketingTitle: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.headline,
    lineHeight: ThemeTokens.typography.lineHeights.headline,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  marketingSubtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  highlightRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.sm,
  },
  highlightChip: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: ThemeTokens.radius.pill,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: 8,
  },
  highlightChipText: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: ThemeTokens.spacing.xs,
  },
  priceValue: {
    color: '#FFFFFF',
    fontFamily: FONT_FAMILY,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: ThemeTokens.typography.weights.bold,
    letterSpacing: ThemeTokens.typography.letterSpacing.headline,
  },
  pricePeriod: {
    color: 'rgba(255,255,255,0.84)',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  marketingCaption: {
    color: 'rgba(255,255,255,0.84)',
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  primaryButton: {
    minHeight: 52,
    borderRadius: ThemeTokens.radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  primaryButtonText: {
    fontFamily: FONT_FAMILY,
    color: '#FFFFFF',
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  secondaryButtonText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  disabledButton: {
    opacity: 0.6,
  },
  refreshLink: {
    alignSelf: 'flex-start',
  },
  refreshLinkText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  loadingCard: {
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    padding: ThemeTokens.spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoCard: {
    borderRadius: ThemeTokens.radius.lg,
    borderWidth: 1,
    padding: ThemeTokens.spacing.lg,
    gap: ThemeTokens.spacing.md,
  },
  sectionTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  definitionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: ThemeTokens.spacing.md,
  },
  definitionItem: {
    width: '47%',
    gap: 2,
  },
  definitionLabel: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.medium,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  definitionValue: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  billingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  billingRowText: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  invoiceRow: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: ThemeTokens.spacing.md,
    gap: ThemeTokens.spacing.sm,
  },
  invoiceInfo: {
    gap: 2,
  },
  invoiceTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  invoiceMeta: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  invoiceActions: {
    flexDirection: 'row',
    gap: ThemeTokens.spacing.sm,
    flexWrap: 'wrap',
  },
  invoiceActionPill: {
    borderRadius: ThemeTokens.radius.pill,
    borderWidth: 1,
    paddingHorizontal: ThemeTokens.spacing.md,
    paddingVertical: 8,
  },
  invoiceActionText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  emptyText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: ThemeTokens.spacing.sm,
  },
  featureText: {
    flex: 1,
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: ThemeTokens.spacing.sm,
  },
  benefitIconWrap: {
    width: 36,
    height: 36,
    borderRadius: ThemeTokens.radius.md,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefitTextWrap: {
    flex: 1,
    gap: 2,
  },
  benefitTitle: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    fontWeight: ThemeTokens.typography.weights.semibold,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
  benefitBody: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.caption,
    lineHeight: ThemeTokens.typography.lineHeights.caption,
    letterSpacing: ThemeTokens.typography.letterSpacing.caption,
  },
  errorText: {
    fontFamily: FONT_FAMILY,
    fontSize: ThemeTokens.typography.sizes.body,
    lineHeight: ThemeTokens.typography.lineHeights.body,
    letterSpacing: ThemeTokens.typography.letterSpacing.body,
  },
});

export default CheckoutScreen;

