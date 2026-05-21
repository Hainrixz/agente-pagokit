# Stripe — Error Mapping Template

Generates `lib/payments/errors.ts` mapping Stripe error codes to PagoKit's cross-provider taxonomy `{code, user_message: {es, en}}`. Used by checkout, refund, and subscription endpoints to show consistent messages to the end customer.

## The cross-provider taxonomy

PagoKit normalizes all provider errors to these codes:

| PagoKit code | Meaning |
|---|---|
| `declined` | Generic decline by issuer |
| `insufficient_funds` | Card has insufficient funds |
| `card_expired` | Card past expiration |
| `incorrect_cvc` | Bad CVC |
| `requires_action` | 3DS / SCA authentication needed |
| `fraud_suspected` | Issuer flagged as fraud |
| `processing_error` | Provider had an issue, retry later |
| `currency_unsupported` | Currency not enabled on the account |
| `amount_too_small` | Below provider's minimum (e.g., < $0.50) |
| `amount_too_large` | Above provider's maximum |
| `rate_limited` | Provider rate limit hit |
| `network_error` | Network failure between you and Stripe |
| `internal_error` | Catch-all unexpected |

## Implementation

```ts
// lib/payments/errors.ts
import Stripe from 'stripe';

export type PagokitErrorCode =
  | 'declined'
  | 'insufficient_funds'
  | 'card_expired'
  | 'incorrect_cvc'
  | 'requires_action'
  | 'fraud_suspected'
  | 'processing_error'
  | 'currency_unsupported'
  | 'amount_too_small'
  | 'amount_too_large'
  | 'rate_limited'
  | 'network_error'
  | 'internal_error';

export interface PagokitError {
  code: PagokitErrorCode;
  user_message: { es: string; en: string };
  raw_code?: string; // for logging, NOT user-facing
}

const STRIPE_CODE_MAP: Record<string, PagokitErrorCode> = {
  card_declined: 'declined',
  insufficient_funds: 'insufficient_funds',
  expired_card: 'card_expired',
  incorrect_cvc: 'incorrect_cvc',
  authentication_required: 'requires_action',
  fraudulent: 'fraud_suspected',
  processing_error: 'processing_error',
  currency_not_supported: 'currency_unsupported',
  amount_too_small: 'amount_too_small',
  amount_too_large: 'amount_too_large',
};

const USER_MESSAGES: Record<PagokitErrorCode, { es: string; en: string }> = {
  declined: {
    es: 'Tu banco rechazó la tarjeta. Intenta con otra tarjeta o contacta a tu banco.',
    en: 'Your bank declined the card. Try another card or contact your bank.',
  },
  insufficient_funds: {
    es: 'La tarjeta no tiene fondos suficientes.',
    en: 'Insufficient funds on the card.',
  },
  card_expired: {
    es: 'La tarjeta está vencida.',
    en: 'The card has expired.',
  },
  incorrect_cvc: {
    es: 'El código de seguridad (CVC) es incorrecto.',
    en: 'The security code (CVC) is incorrect.',
  },
  requires_action: {
    es: 'Tu banco requiere autenticación adicional. Sigue las instrucciones en pantalla.',
    en: 'Your bank requires additional authentication. Follow the on-screen instructions.',
  },
  fraud_suspected: {
    es: 'Tu banco marcó este intento como sospechoso. Contáctalo para autorizar la compra.',
    en: 'Your bank flagged this attempt. Contact them to authorize the purchase.',
  },
  processing_error: {
    es: 'Hubo un problema procesando el pago. Intenta de nuevo en unos minutos.',
    en: 'A processing error occurred. Try again in a few minutes.',
  },
  currency_unsupported: {
    es: 'Esta moneda no está habilitada en la cuenta de pago.',
    en: 'This currency is not enabled on the payment account.',
  },
  amount_too_small: {
    es: 'El monto es menor al mínimo permitido.',
    en: 'The amount is below the minimum allowed.',
  },
  amount_too_large: {
    es: 'El monto excede el máximo permitido.',
    en: 'The amount exceeds the maximum allowed.',
  },
  rate_limited: {
    es: 'Demasiadas solicitudes. Espera unos segundos e intenta de nuevo.',
    en: 'Too many requests. Wait a few seconds and try again.',
  },
  network_error: {
    es: 'No pudimos conectar con el proveedor de pagos. Verifica tu conexión.',
    en: 'Could not reach the payment provider. Check your connection.',
  },
  internal_error: {
    es: 'Algo falló de nuestro lado. Inténtalo más tarde.',
    en: 'Something went wrong on our side. Try again later.',
  },
};

export function mapStripeError(err: unknown): PagokitError {
  if (err instanceof Stripe.errors.StripeCardError) {
    const code: PagokitErrorCode = STRIPE_CODE_MAP[err.code ?? ''] ?? 'declined';
    return { code, user_message: USER_MESSAGES[code], raw_code: err.code };
  }
  if (err instanceof Stripe.errors.StripeRateLimitError) {
    return { code: 'rate_limited', user_message: USER_MESSAGES.rate_limited };
  }
  if (err instanceof Stripe.errors.StripeConnectionError) {
    return { code: 'network_error', user_message: USER_MESSAGES.network_error };
  }
  if (err instanceof Stripe.errors.StripeInvalidRequestError) {
    const code: PagokitErrorCode = STRIPE_CODE_MAP[err.code ?? ''] ?? 'internal_error';
    return { code, user_message: USER_MESSAGES[code], raw_code: err.code };
  }
  return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
}
```

## Usage in checkout

```ts
import { mapStripeError } from '@/lib/payments/errors';

try {
  await stripe.paymentIntents.create({ ... });
} catch (err) {
  const mapped = mapStripeError(err);
  console.error('[checkout] stripe error', {
    pagokit_code: mapped.code,
    raw_code: mapped.raw_code,
    // Rule 6: don't log err.message — may include amounts and customer ids
  });
  return NextResponse.json(
    {
      error: mapped.code,
      message: mapped.user_message[detectedLanguage], // pick es | en
    },
    { status: 400 }
  );
}
```

## Anti-patterns

- ❌ Returning `err.message` directly to the client — Stripe error messages include internal IDs that leak architecture.
- ❌ Throwing the raw Stripe error from a Server Action / API Route — same leak.
- ❌ Logging the full `err` object (Rule 6 — no PII in logs). Use `{ pagokit_code, raw_code }`.
- ❌ Translating user_message dynamically with LLM calls. Static translations only — Stripe errors must be deterministic.

## Extending to other providers

When integration-specialist also generates Mercado Pago / Wompi / LS code, append to the same `lib/payments/errors.ts` file:

```ts
import { mapMercadoPagoError } from './errors-mercadopago';
import { mapWompiError } from './errors-wompi';
import { mapLemonSqueezyError } from './errors-lemonsqueezy';

export function mapPaymentError(provider: string, err: unknown): PagokitError {
  switch (provider) {
    case 'stripe': return mapStripeError(err);
    case 'mercadopago': return mapMercadoPagoError(err);
    case 'wompi': return mapWompiError(err);
    case 'lemonsqueezy': return mapLemonSqueezyError(err);
    default: return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
  }
}
```

Each provider's `errors.md` contributes a `mapXxxError` function.

## Security rules cited

- Rule 6: log `pagokit_code` and `raw_code`, never `err.message` or stacktrace with PII.
- Rule 11: user-facing messages are minimal — no order IDs, no customer emails leaked back.
