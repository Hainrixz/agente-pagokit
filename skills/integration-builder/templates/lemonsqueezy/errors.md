# Lemon Squeezy — Error Mapping

Generates `lib/payments/errors-lemonsqueezy.ts`. Same cross-provider taxonomy as the shared `errors.ts`.

## Implementation

```ts
// lib/payments/errors-lemonsqueezy.ts
import type { PagokitError, PagokitErrorCode } from './errors';
import { USER_MESSAGES } from './errors';

const LS_ERROR_CODE_MAP: Record<string, PagokitErrorCode> = {
  // From https://docs.lemonsqueezy.com/api/error-codes
  'unauthorized': 'internal_error',
  'forbidden': 'internal_error',
  'validation_error': 'declined',
  'too_many_requests': 'rate_limited',
  'card_error': 'declined',
  'insufficient_funds': 'insufficient_funds',
  'expired_card': 'card_expired',
  'incorrect_cvc': 'incorrect_cvc',
  'fraudulent': 'fraud_suspected',
  'currency_not_supported': 'currency_unsupported',
};

export function mapLemonSqueezyError(err: any): PagokitError {
  // LS errors come in the JSON:API format:
  // { errors: [{ status: '422', code: 'validation_error', title: '...', detail: '...' }] }
  if (err?.errors && Array.isArray(err.errors) && err.errors.length > 0) {
    const first = err.errors[0];
    const code = LS_ERROR_CODE_MAP[first.code ?? ''] ?? 'internal_error';
    return {
      code,
      user_message: USER_MESSAGES[code],
      raw_code: first.code ?? first.title ?? 'unknown',
    };
  }

  // Network errors
  if (err?.name === 'AbortError' || err?.code === 'ETIMEDOUT' || err?.code === 'ECONNREFUSED') {
    return { code: 'network_error', user_message: USER_MESSAGES.network_error };
  }

  // 4xx / 5xx responses without JSON:API body
  if (err?.status >= 500) {
    return { code: 'processing_error', user_message: USER_MESSAGES.processing_error };
  }
  if (err?.status === 429) {
    return { code: 'rate_limited', user_message: USER_MESSAGES.rate_limited };
  }

  return { code: 'internal_error', user_message: USER_MESSAGES.internal_error };
}
```

## Usage

```ts
import { mapLemonSqueezyError } from '@/lib/payments/errors-lemonsqueezy';

try {
  const checkout = await createCheckout(/* ... */);
  if (checkout.error) {
    const mapped = mapLemonSqueezyError(checkout.error);
    console.error('[ls.checkout] error', {
      pagokit_code: mapped.code,
      raw_code: mapped.raw_code,
    });
    return NextResponse.json(
      { error: mapped.code, message: mapped.user_message[lang] },
      { status: 400 }
    );
  }
} catch (err) {
  const mapped = mapLemonSqueezyError(err);
  // ... same pattern
}
```

## What LS doesn't tell you

LS errors are coarse-grained. A card decline returns `code: 'card_error'` without details about why (insufficient funds vs incorrect CVC vs blocked). The end-user message will often be generic "declined". For finer error analytics, you must inspect the *order* webhook payload or the LS dashboard logs — both arrive after the failure.

## Anti-patterns

- ❌ Showing `error.detail` directly to the user — JSON:API includes internal LS terms.
- ❌ Mapping all errors to `declined` — `rate_limited` and `network_error` benefit from distinct UX.
- ❌ Logging `err` directly — JSON:API responses include the trace id, which is fine, but the full body may include PII.

## Security rules cited

- Rule 6: log `{ pagokit_code, raw_code }` only.
