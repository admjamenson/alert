import {
  confirmPaymentSheetPayment,
  initPaymentSheet,
  initStripe,
  presentPaymentSheet,
} from '@stripe/stripe-react-native';
import { Platform } from 'react-native';

export interface PaymentSheetResult {
  canceled?: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaymentSheetInitOptions {
  publishableKey: string;
  customerId: string;
  customerEphemeralKeySecret: string;
  paymentIntentClientSecret: string;
  merchantDisplayName: string;
  merchantCountryCode?: string;
  currencyCode?: string;
  returnURL?: string;
  enableApplePay?: boolean;
  enableGooglePay?: boolean;
  allowsDelayedPaymentMethods?: boolean;
}

const normalizeError = (error: unknown): { code: string; message: string } => {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    'message' in error
  ) {
    const err = error as { code?: unknown; message?: unknown };
    return {
      code: String(err.code || 'unknown'),
      message: String(err.message || 'Unknown error'),
    };
  }

  return {
    code: 'unknown',
    message:
      error instanceof Error ? error.message : String(error || 'Unknown error'),
  };
};

const isCanceledError = (error: { code: string; message: string }) => {
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  return code.includes('cancel') || message.includes('cancel');
};

export class PaymentSheetAdapter {
  static async initPaymentSheet(
    options: PaymentSheetInitOptions,
  ): Promise<PaymentSheetResult> {
    try {
      const {
        publishableKey,
        customerId,
        customerEphemeralKeySecret,
        paymentIntentClientSecret,
        merchantDisplayName,
        merchantCountryCode = 'US',
        currencyCode = 'USD',
        returnURL,
        enableApplePay = Platform.OS === 'ios',
        enableGooglePay = false,
        allowsDelayedPaymentMethods = false,
      } = options;

      await initStripe({
        publishableKey,
        urlScheme: 'alertapp',
        setReturnUrlSchemeOnAndroid: true,
      });

      const { error } = await initPaymentSheet({
        customerId,
        customerEphemeralKeySecret,
        paymentIntentClientSecret,
        merchantDisplayName,
        returnURL,
        allowsDelayedPaymentMethods,
        applePay:
          enableApplePay && Platform.OS === 'ios'
            ? {
                merchantCountryCode,
              }
            : undefined,
        googlePay:
          enableGooglePay && Platform.OS === 'android'
            ? {
                merchantCountryCode,
                currencyCode,
                testEnv: false,
              }
            : undefined,
      });

      if (error) {
        return { error: normalizeError(error) };
      }

      return {};
    } catch (error) {
      return { error: normalizeError(error) };
    }
  }

  static async presentPaymentSheet(): Promise<PaymentSheetResult> {
    try {
      const { error } = await presentPaymentSheet();

      if (error) {
        const normalizedError = normalizeError(error);
        if (isCanceledError(normalizedError)) {
          return { canceled: true };
        }
        return { error: normalizedError };
      }

      return {};
    } catch (error) {
      const normalizedError = normalizeError(error);
      if (isCanceledError(normalizedError)) {
        return { canceled: true };
      }
      return { error: normalizedError };
    }
  }

  static async confirmPaymentSheetPayment(): Promise<PaymentSheetResult> {
    try {
      const { error } = await confirmPaymentSheetPayment();

      if (error) {
        const normalizedError = normalizeError(error);
        if (isCanceledError(normalizedError)) {
          return { canceled: true };
        }
        return { error: normalizedError };
      }

      return {};
    } catch (error) {
      const normalizedError = normalizeError(error);
      if (isCanceledError(normalizedError)) {
        return { canceled: true };
      }
      return { error: normalizedError };
    }
  }
}
