/**
 * @fee/payment-contracts
 *
 * Gateway-agnostic payment interfaces: the adapter contract every provider
 * implements, the state machines that guard every status change, provider
 * signature verification, and deterministic gateway routing.
 *
 * The payment engine depends on this package and never on a provider SDK, which
 * is what makes "add a gateway without changing the application" true.
 */

export {
  GatewayError,
  type CreateOrderInput,
  type CreateOrderResult,
  type GatewayCredentials,
  type GatewayCustomer,
  type GatewayRouteCandidate,
  type GatewayRouteContext,
  type GatewayRouteDecision,
  type GatewayTransactionStatus,
  type GetPaymentStatusInput,
  type PaymentGatewayAdapter,
  type PaymentStatusResult,
  type ProviderOrderState,
  type RawGatewayStatus,
  type RefundPaymentInput,
  type RefundResult,
  type VerifyPaymentInput,
  type VerifyPaymentResult,
  type VerifyOrderClosureInput,
  type VerifyOrderClosureResult,
  type VerifyWebhookInput,
  type WebhookResult,
} from './types';

export {
  InvalidTransitionError,
  TERMINAL_PAYMENT_STATUSES,
  assertDemandTransition,
  assertPaymentTransition,
  assertRefundTransition,
  canTransitionDemand,
  canTransitionPayment,
  canTransitionRefund,
  demandTransitionsFrom,
  deriveDemandStatus,
  gatewayStatusToPaymentStatus,
  isPaymentAllocatable,
  isPaymentSettled,
  paymentTransitionsFrom,
} from './state-machine';

export {
  buildPayuHash,
  hmacSha256Base64,
  hmacSha256Hex,
  parseStripeSignatureHeader,
  sha512,
  timingSafeEqualStrings,
  verifyCashfreeWebhookSignature,
  verifyPayuResponseHash,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  verifyStripeWebhookSignature,
  type StripeSignatureParts,
} from './signatures';

export {
  CashfreeAdapter,
  MockGatewayAdapter,
  PayuAdapter,
  RazorpayAdapter,
  StripeAdapter,
  headerValue,
  type MockGatewayOptions,
} from './adapters';

export { routeGateways, selectGateway, type GatewayRoutePlan } from './selector';

import type { GatewayProvider } from '@fee/types';
import { CashfreeAdapter, MockGatewayAdapter, PayuAdapter, RazorpayAdapter, StripeAdapter } from './adapters';
import type { PaymentGatewayAdapter } from './types';

/**
 * Adapter registry. A new provider is one entry here plus a configuration row -
 * no call site changes, which is the property the architecture promises.
 */
export function createAdapter(
  provider: GatewayProvider,
  options?: ConstructorParameters<typeof MockGatewayAdapter>[0],
): PaymentGatewayAdapter {
  switch (provider) {
    case 'RAZORPAY':
      return new RazorpayAdapter();
    case 'CASHFREE':
      return new CashfreeAdapter();
    case 'PAYU':
      return new PayuAdapter();
    case 'STRIPE':
      return new StripeAdapter();
    case 'MOCK':
      return new MockGatewayAdapter(options);
    default: {
      const exhaustive: never = provider;
      throw new Error(`No payment adapter registered for provider ${String(exhaustive)}`);
    }
  }
}
