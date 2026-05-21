# Mercado Pago — Error Mapping

Generates `lib/payments/errors-mercadopago.ts`. Same cross-provider taxonomy as `templates/stripe/errors.md`; only the source codes differ.

## Implementation

```ts
// lib/payments/errors-mercadopago.ts
import type { PagokitError, PagokitErrorCode } from './errors';
// USER_MESSAGES is exported from ./errors

const MP_STATUS_DETAIL_MAP: Record<string, PagokitErrorCode> = {
  // From https://www.mercadopago.com/developers/en/docs/checkout-api/response-handling/status-codes
  cc_rejected_other_reason: 'declined',
  cc_rejected_insufficient_amount: 'insufficient_funds',
  cc_rejected_call_for_authorize: 'declined',
  cc_rejected_card_disabled: 'declined',
  cc_rejected_card_error: 'declined',
  cc_rejected_duplicated_payment: 'declined',
  cc_rejected_high_risk: 'fraud_suspected',
  cc_rejected_bad_filled_card_number: 'declined',
  cc_rejected_bad_filled_date: 'card_expired',
  cc_rejected_bad_filled_security_code: 'incorrect_cvc',
  cc_rejected_bad_filled_other: 'declined',
  cc_rejected_blacklist: 'fraud_suspected',
  cc_rejected_invalid_installments: 'declined',
  cc_rejected_max_attempts: 'rate_limited',
  cc_rejected_3ds_mandatory: 'requires_action',
  cc_rejected_3ds_challenge: 'requires_action',
};

const MP_API_ERROR_MAP: Record<string, PagokitErrorCode> = {
  invalid_currency_id: 'currency_unsupported',
  too_many_requests: 'rate_limited',
  invalid_payer_email: 'declined',
};

export function mapMercadoPagoError(err: any): PagokitError {
  // MP errors come as:
  //   { error: 'bad_request', status: 400, cause: [{ code: '123', description: '...' }], message: '...' }
  // or as a payment response with status='rejected' + status_detail='cc_rejected_*'
  
  // Case A: payment with rejection detail
  if (err?.status_detail && MP_STATUS_DETAIL_MAP[err.status_detail]) {
    const code = MP_STATUS_DETAIL_MAP[err.status_detail];
    return {
      code,
      user_message: USER_MESSAGES[code],
      raw_code: err.status_detail,
    };
  }

  // Case B: API error
  if (err?.error && typeof err.error === 'string') {
    const code = MP_API_ERROR_MAP[err.error] ?? 'internal_error';
    return {
      code,
      user_message: USER_MESSAGES[code],
      raw_code: err.error,
    };
  }

  // Case C: thrown by fetch (network)
  if (err?.name === 'AbortError' || err?.code === 'ECONNREFUSED' || err?.code === 'ETIMEDOUT') {
    return { code: 'network_error', user_message: USER_MESSAGES.network_error };
  }

  return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
}

// Re-export the shared USER_MESSAGES so this file is self-contained if needed
import { USER_MESSAGES } from './errors';
```

## Usage in the charge endpoint

```ts
import { mapMercadoPagoError } from '@/lib/payments/errors-mercadopago';

try {
  const payment = await mpPayment.create({ body: {...} });
  if (payment.status === 'rejected') {
    const mapped = mapMercadoPagoError(payment);
    return NextResponse.json(
      { error: mapped.code, message: mapped.user_message[lang] },
      { status: 400 }
    );
  }
  return NextResponse.json({ payment_id: payment.id });
} catch (err) {
  const mapped = mapMercadoPagoError(err);
  console.error('[mp.charge] error', { pagokit_code: mapped.code, raw_code: mapped.raw_code });
  return NextResponse.json(
    { error: mapped.code, message: mapped.user_message[lang] },
    { status: 500 }
  );
}
```

## Notes on `status_detail` quirks

MP's `cc_rejected_*` codes can vary slightly per country. The `_3ds_mandatory` / `_3ds_challenge` ones are recent (2024+) and indicate the customer must complete SCA — surface them as `requires_action` and let the frontend re-tokenize with a fresh card-data challenge.

`cc_rejected_call_for_authorize` is a "soft decline" — the bank wants the customer to call them. Surface as `declined` with the standard message; don't expose the call-to-bank requirement (rarely actionable, often confusing).

## Anti-patterns

- ❌ Showing `payment.status_detail` directly to the user (raw codes leak).
- ❌ Treating `cc_rejected_max_attempts` as a permanent failure — rate-limit messaging is appropriate.
- ❌ Mapping `cc_rejected_high_risk` to `declined` without logging — fraud signals are worth analytics.

## Security rules cited

- Rule 6: log `{ pagokit_code, raw_code }` only.
