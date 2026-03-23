/**
 * Register Stripe In-App Checkout Routes
 * POST /api/billing/create-payment-intent - Criar intent de pagamento (SEGURO: sem dados de cartão)
 * GET /api/billing/payment-status/:intentId - Verificar status
 *
 * ✅ SEGURO: Stripe Payment Sheet gerencia captura de cartão no cliente
 * Nunca enviamos dados brutos de cartão para o backend
 */

const StripeCheckoutService = require('./StripeCheckoutService');
const {
  PremiumBillingUnifier,
} = require('../../src/domain/billing/PremiumBillingUnifier');

const registerStripeCheckoutRoutes = (app, db, auth) => {
  /**
   * POST /api/billing/create-payment-intent
   * Cria um PaymentIntent para o Stripe Payment Sheet processar no cliente
   */
  app.post(
    '/api/billing/create-payment-intent',
    auth.requireUser(),
    async (req, res) => {
      try {
        const { amount, currency, planType } = req.body;
        const userId = req.user.uid;

        if (!amount || !currency || !planType) {
          return res
            .status(400)
            .json({ error: 'Missing amount, currency, or planType' });
        }

        const intent = await StripeCheckoutService.createPaymentIntent(
          userId,
          amount,
          currency,
          planType,
        );

        return res.json({
          clientSecret: intent.clientSecret,
          paymentIntentId: intent.paymentIntentId,
          status: intent.status,
        });
      } catch (error) {
        console.error('[StripeCheckout] createPaymentIntent error:', error);
        return res.status(500).json({
          error: error.message || 'Erro ao criar payment intent',
        });
      }
    },
  );

  /**
   * GET /api/billing/payment-status/:intentId
   * Verifica status de um PaymentIntent
   */
  app.get(
    '/api/billing/payment-status/:intentId',
    auth.requireUser(),
    async (req, res) => {
      try {
        const { intentId } = req.params;

        const status = await StripeCheckoutService.getPaymentIntentStatus(
          intentId,
        );

        // Se pagamento foi bem-sucedido, atualizar entitlements
        if (status.status === 'succeeded') {
          const userId = req.user.uid;
          const subscriptionData = {
            user_id: userId,
            billing_provider: 'stripe',
            provider_customer_id: intentId.split('_')[1] || 'unknown',
            provider_subscription_id: intentId,
            subscription_status: 'active',
            premium_active: true,
            subscription_plan: 'monthly', // Padrão - deve vir do Payment Intent metadata
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            premium_updated_at: new Date(),
            updated_at: new Date(),
          };

          await db
            .collection('billing_subscriptions')
            .doc(userId)
            .set(subscriptionData, { merge: true });

          await db.collection('entitlements').doc(userId).set(
            {
              user_id: userId,
              isPremium: true,
              billingProvider: 'stripe',
              subscriptionStatus: 'active',
              currentPeriodEnd:
                subscriptionData.current_period_end.toISOString(),
              updated_at: new Date(),
            },
            { merge: true },
          );

          console.log(
            `[StripeCheckout] Entitlements atualizados para=${userId} paymentIntentId=${intentId}`,
          );
        }

        return res.json(status);
      } catch (error) {
        console.error('[StripeCheckout] getPaymentIntentStatus error:', error);
        return res.status(500).json({
          error: error.message || 'Erro ao recuperar status do pagamento',
        });
      }
    },
  );
};

module.exports = registerStripeCheckoutRoutes;
