# Wompi — Error Mapping

Generates `lib/payments/errors-wompi.ts`. Same cross-provider taxonomy as the shared `errors.ts`.

## Implementation

```ts
// lib/payments/errors-wompi.ts
import type { PagokitError, PagokitErrorCode } from './errors';
import { USER_MESSAGES } from './errors';

// Wompi exposes failure reasons in transaction.status_message and transaction.payment_source_id error codes.
// Map by string matching of the most common ones.
const WOMPI_REASON_PATTERNS: Array<{ pattern: RegExp; code: PagokitErrorCode }> = [
  { pattern: /insufficient|fondos insuficientes/i, code: 'insufficient_funds' },
  { pattern: /expired|tarjeta vencida|vencimiento/i, code: 'card_expired' },
  { pattern: /cvv|cvc|cód.*seguridad/i, code: 'incorrect_cvc' },
  { pattern: /fraud|sospechos/i, code: 'fraud_suspected' },
  { pattern: /declined|rechaz/i, code: 'declined' },
  { pattern: /3ds|three.?d.?s|autenticación/i, code: 'requires_action' },
  { pattern: /timeout|tiempo agotado/i, code: 'processing_error' },
];

export function mapWompiError(err: any): PagokitError {
  // Case A: a transaction object with a failure status
  if (err?.transaction?.status === 'DECLINED' || err?.status === 'DECLINED') {
    const reason = err.transaction?.status_message ?? err.status_message ?? '';
    for (const { pattern, code } of WOMPI_REASON_PATTERNS) {
      if (pattern.test(reason)) {
        return {
          code,
          user_message: USER_MESSAGES[code],
          raw_code: reason,
        };
      }
    }
    return { code: 'declined', user_message: USER_MESSAGES.declined, raw_code: reason };
  }

  // Case B: an API error from Wompi's REST
  if (err?.error?.type) {
    switch (err.error.type) {
      case 'INVALID_PUBLIC_KEY':
      case 'INVALID_PRIVATE_KEY':
        return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
      case 'TOO_MANY_REQUESTS':
        return { code: 'rate_limited', user_message: USER_MESSAGES.rate_limited };
      case 'INVALID_AMOUNT':
        return { code: 'amount_too_small', user_message: USER_MESSAGES.amount_too_small };
      default:
        return { code: 'internal_error', user_message: USER_MESSAGES.internal_error, raw_code: err.error.type };
    }
  }

  // Case C: network
  if (err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') {
    return { code: 'network_error', user_message: USER_MESSAGES.network_error };
  }

  return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
}
```

## Usage

```ts
import { mapWompiError } from '@/lib/payments/errors-wompi';

// In the webhook handler when status === DECLINED:
if (tx.status === 'DECLINED') {
  const mapped = mapWompiError({ transaction: tx });
  console.error('[wompi.webhook] declined', {
    pagokit_code: mapped.code,
    raw_code: mapped.raw_code,
    tx_id: tx.id,
  });
}
```

## Notes on Wompi's error surface

Wompi exposes failure reasons in two main places:

1. `transaction.status_message` — Spanish prose. Useful for pattern matching, not for showing the user.
2. REST API errors with `error.type` and `error.messages` — structured but limited categories.

Cash voucher failures (Efecty/Baloto expirations) come through as `DECLINED` with `status_message` like "Cupón vencido". The mapper treats these as generic `declined` for end-user messaging; analytics should log the raw reason.

## Anti-patterns

- ❌ Showing `transaction.status_message` directly to the user — it's Spanish, prose, and sometimes mentions internal IDs.
- ❌ Mapping all DECLINED to "card declined" — Wompi covers cards, PSE, Nequi, cash. "Tarjeta declinada" is wrong for a PSE failure.
- ❌ Logging the full `err` object — may include the customer's phone or Cédula.

## Security rules cited

- Rule 6: log `{ pagokit_code, raw_code, tx_id }` only; never the full transaction or status_message.
