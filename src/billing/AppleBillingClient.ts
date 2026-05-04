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

const isAndroidPurchase = (
  purchase: RNIap.Purchase,
): purchase is RNIap.PurchaseAndroid =>
  purchase.platform === 'android';

const getIosPurchase = (
  purchase: RNIap.Purchase | null,
): RNIap.PurchaseIOS | null => {
  if (!purchase || Platform.OS !== 'ios') return null;
  return purchase as RNIap.PurchaseIOS;
};

class AppleBillingClient {
  private initialized = false;
  private currentProducts: AppleStoreProduct[] = [];
  private currentPurchase: RNIap.Purchase | null = null;
  private purchaseUpdateSubscription: RNIap.EventSubscription | null = null;
  private purchaseErrorSubscription: RNIap.EventSubscription | null = null;

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
    this.purchaseUpdateSubscription = RNIap.purchaseUpdatedListener(
      async (purchase: RNIap.Purchase) => {
        console.log(
          '[AppleBillingClient] Purchase updated:',
          purchase.productId,
        );
        this.currentPurchase = purchase;

        if (isAndroidPurchase(purchase) && !purchase.isAcknowledgedAndroid) {
          try {
            await RNIap.acknowledgePurchaseAndroid(
              String(purchase.purchaseToken || ''),
            );
          } catch (error) {
            console.error(
              '[AppleBillingClient] Failed to acknowledge purchase:',
              error,
            );
          }
        }

        if (isAndroidPurchase(purchase)) {
          try {
            await RNIap.consumePurchaseAndroid(
              String(purchase.purchaseToken || ''),
            );
          } catch (error) {
            console.error(
              '[AppleBillingClient] Failed to consume purchase:',
              error,
            );
          }
        }
      },
    );

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
      const result = await RNIap.fetchProducts({
        skus: APPLE_PRODUCT_IDS,
        type: 'subs',
      });

      const products = Array.isArray(result) ? result : [];
      this.currentProducts = products.map(product => ({
        productId: product.id,
        title: product.title,
        description: product.description,
        price: product.displayPrice || String(product.price || ''),
        currency: product.currency || 'USD',
        localizedPrice: product.displayPrice || String(product.price || ''),
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

      await RNIap.requestPurchase({
        request: {
          ios: {
            sku: productId,
          },
        },
        type: 'subs',
      });

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
    const iosPurchase = getIosPurchase(this.currentPurchase);

    return {
      transactionId: String(
        this.currentPurchase.transactionId || this.currentPurchase.id || '',
      ),
      originalTransactionId: String(
        iosPurchase?.originalTransactionIdentifierIOS ||
          this.currentPurchase.transactionId ||
          this.currentPurchase.id ||
          '',
      ),
      bundleId: String(iosPurchase?.appBundleIdIOS || ''),
      productId: this.currentPurchase.productId,
      purchaseTime: this.currentPurchase.transactionDate || Date.now(),
    };
  }

  async restorePurchases(): Promise<AppleEntitlement[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      console.log('[AppleBillingClient] Restoring purchases...');
      const purchases = await RNIap.getAvailablePurchases({
        onlyIncludeActiveItemsIOS: false,
      });

      const entitlements: AppleEntitlement[] = purchases
        .filter(purchase => APPLE_PRODUCT_IDS.includes(purchase.productId))
        .map(purchase => {
          const iosPurchase = getIosPurchase(purchase);
          return {
            productId: purchase.productId,
            expiresDate: iosPurchase?.expirationDateIOS
              ? new Date(Number(iosPurchase.expirationDateIOS)).toISOString()
              : null,
            originalTransactionId: String(
              iosPurchase?.originalTransactionIdentifierIOS ||
                purchase.transactionId ||
                purchase.id ||
                '',
            ),
            transactionId: String(purchase.transactionId || purchase.id || ''),
            bundleId: String(iosPurchase?.appBundleIdIOS || ''),
            isActive:
              typeof iosPurchase?.expirationDateIOS === 'number'
                ? iosPurchase.expirationDateIOS > Date.now()
                : true,
          };
        });

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
        await RNIap.finishTransaction({
          purchase: this.currentPurchase,
          isConsumable: false,
        });
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
        this.purchaseUpdateSubscription.remove();
      }
      if (this.purchaseErrorSubscription) {
        this.purchaseErrorSubscription.remove();
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
