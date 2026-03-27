import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface AppleStoreProduct {
  productId: string;
  title: string;
  description: string;
  price: string;
  currency: string;
  localizedPrice: string;
  type: 'iap' | 'subscription';
}

export interface ApplePurchaseResult {
  transactionId: string;
  originalTransactionId: string;
  bundleId: string;
  productId: string;
  purchaseTime: number;
  purchaseStateAndroid?: number;
  purchaseToken?: string;
  autoRenewing?: boolean;
  acknowledgeAndroidPurchase?: (token: string) => void;
}

export interface AppleEntitlement {
  productId: string;
  expiresDate: string | null;
  originalTransactionId: string;
  transactionId: string;
  bundleId: string;
  isActive: boolean;
}

const APPLE_PRODUCT_IDS = [
  'alert.premium.monthly',
  'alert.premium.annual',
  'alert.premium.lifetime',
];

class AppleBillingClient {
  private initialized = false;
  private currentProducts: AppleStoreProduct[] = [];
  private currentPurchase: RNIap.PurchaseResult | null = null;
  private purchaseUpdateSubscription: (() => void) | null = null;
  private purchaseErrorSubscription: (() => void) | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (Platform.OS !== 'ios') {
      throw new Error('AppleBillingClient only works on iOS');
    }

    try {
      await RNIap.initConnection();
      this.initialized = true;
      this.setupListeners();
    } catch (error) {
      console.error('[AppleBillingClient] Initialization failed:', error);
      throw new Error('failed_to_initialize_storekit');
    }
  }

  private setupListeners(): void {
    // Listen for purchase updates
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: RNIap.PurchaseResult) => {
        console.log(
          '[AppleBillingClient] Purchase updated:',
          purchase.productId,
        );
        this.currentPurchase = purchase;

        // Acknowledge purchase on Android (iOS doesn't require this, but we handle both)
        if (Platform.OS === 'android' && !purchase.isAcknowledgedAndroid) {
          try {
            await RNIap.acknowledgePurchaseAndroid(purchase.purchaseToken);
          } catch (error) {
            console.error(
              '[AppleBillingClient] Failed to acknowledge purchase:',
              error,
            );
          }
        }

        // Consume purchase if needed
        if (Platform.OS === 'android') {
          try {
            await RNIap.consumePurchaseAndroid(purchase.purchaseToken);
          } catch (error) {
            console.error(
              '[AppleBillingClient] Failed to consume purchase:',
              error,
            );
          }
        }
      },
    );

    // Listen for purchase errors
    this.purchaseErrorSubscription = RNIap.purchaseErrorListener(
      (error: RNIap.PurchaseError) => {
        console.error('[AppleBillingClient] Purchase error:', error.message);
      },
    );
  }

  async fetchProducts(): Promise<AppleStoreProduct[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const result = await RNIap.getSubscriptions({
        skus: APPLE_PRODUCT_IDS,
      });

      this.currentProducts = result.map(product => ({
        productId: product.productId,
        title: product.title,
        description: product.description,
        price: product.price,
        currency: product.currency || 'USD',
        localizedPrice: product.localizedPrice || product.price,
        type: 'subscription',
      }));

      return this.currentProducts;
    } catch (error) {
      console.error('[AppleBillingClient] Failed to fetch products:', error);
      throw new Error('failed_to_fetch_products');
    }
  }

  async requestPurchase(productId: string): Promise<boolean> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!APPLE_PRODUCT_IDS.includes(productId)) {
      throw new Error('invalid_product_id');
    }

    try {
      console.log(`[AppleBillingClient] Requesting purchase for ${productId}`);
      this.currentPurchase = null;

      await RNIap.requestSubscription({
        sku: productId,
        andDangerouslyFinishTransactionAutomaticallyIOS: false,
      });

      // Wait for purchase result
      return await new Promise<boolean>((resolve, timeout) => {
        const maxWait = 30000; // 30 seconds
        const startTime = Date.now();

        const checkPurchase = setInterval(() => {
          if (this.currentPurchase) {
            clearInterval(checkPurchase);
            resolve(true);
          }

          if (Date.now() - startTime > maxWait) {
            clearInterval(checkPurchase);
            resolve(false);
          }
        }, 500);
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'User cancelled the purchase'
      ) {
        throw new Error('user_cancelled_purchase');
      }
      console.error('[AppleBillingClient] Purchase failed:', error);
      throw new Error('purchase_failed');
    }
  }

  getCurrentPurchase(): ApplePurchaseResult | null {
    if (!this.currentPurchase) return null;

    return {
      transactionId: String(this.currentPurchase.transactionId || ''),
      originalTransactionId: String(
        this.currentPurchase.originalTransactionId || '',
      ),
      bundleId: String(this.currentPurchase.bundleId || ''),
      productId: this.currentPurchase.productId,
      purchaseTime: this.currentPurchase.purchaseTime || Date.now(),
    };
  }

  async restorePurchases(): Promise<AppleEntitlement[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      console.log('[AppleBillingClient] Restoring purchases...');
      const purchases = await RNIap.getPurchaseHistory();

      const entitlements: AppleEntitlement[] = purchases
        .filter(purchase => APPLE_PRODUCT_IDS.includes(purchase.productId))
        .map(purchase => ({
          productId: purchase.productId,
          expiresDate: purchase.expirationDate
            ? new Date(parseInt(purchase.expirationDate)).toISOString()
            : null,
          originalTransactionId: String(purchase.originalTransactionId || ''),
          transactionId: String(purchase.transactionId || ''),
          bundleId: String(purchase.bundleId || ''),
          isActive:
            purchase.expirationDate &&
            parseInt(purchase.expirationDate) > Date.now()
              ? true
              : false,
        }));

      return entitlements;
    } catch (error) {
      console.error('[AppleBillingClient] Restore purchases failed:', error);
      throw new Error('restore_purchases_failed');
    }
  }

  async finishTransaction(transactionId?: string): Promise<void> {
    if (!this.initialized) {
      return;
    }

    try {
      if (this.currentPurchase) {
        if (Platform.OS === 'ios') {
          await RNIap.finishTransactionIOS(this.currentPurchase.transactionId);
        }
        this.currentPurchase = null;
      }
    } catch (error) {
      console.error(
        '[AppleBillingClient] Failed to finish transaction:',
        error,
      );
    }
  }

  async disconnect(): Promise<void> {
    try {
      if (this.purchaseUpdateSubscription) {
        this.purchaseUpdateSubscription();
      }
      if (this.purchaseErrorSubscription) {
        this.purchaseErrorSubscription();
      }
      await RNIap.endConnection();
      this.initialized = false;
    } catch (error) {
      console.error('[AppleBillingClient] Disconnect failed:', error);
    }
  }

  getProductById(productId: string): AppleStoreProduct | undefined {
    return this.currentProducts.find(p => p.productId === productId);
  }

  getAllProducts(): AppleStoreProduct[] {
    return this.currentProducts;
  }
}

export const appleBillingClient = new AppleBillingClient();
