# Lemon Squeezy — One-time Payment Template

Creates a hosted checkout URL for a one-time purchase. The customer pays on LS's checkout page; LS handles tax automatically as MoR.

## Pre-requisites

In the LS dashboard:
1. Create a **product** (your digital good).
2. Create a **variant** with the one-time price.
3. Note the **store ID** and **variant ID** (the SDK needs both).

You can store the variant ID alongside your product in your DB, or fetch it dynamically via `listProducts()`.

## Checkout endpoint — Next.js App Router

```ts
// app/api/checkout/route.ts
import { NextResponse } from 'next/server';
import { createCheckout } from '@/lib/payments/lemonsqueezy';
import { db } from '@/lib/db';
import { getServerSession } from 'next-auth';

export const runtime = 'nodejs';

interface CheckoutInput {
  productId: string; // your DB product id (PagoKit maps to LS variant id)
}

export async function POST(request: Request) {
  const { productId }: CheckoutInput = await request.json();

  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  // Look up your product → LS variant id mapping
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.lemonsqueezy_variant_id) {
    return NextResponse.json({ error: 'product_not_found' }, { status: 404 });
  }

  const storeId = process.env.LEMONSQUEEZY_STORE_ID!;
  const variantId = product.lemonsqueezy_variant_id;

  try {
    const checkout = await createCheckout(storeId, variantId, {
      checkoutOptions: {
        embed: false, // true to use the overlay embed
        media: false, // hide product image
      },
      checkoutData: {
        email: session.user.email ?? undefined,
        name: session.user.name ?? undefined,
        custom: {
          user_id: session.user.id,
          product_id: product.id,
        },
      },
      productOptions: {
        redirectUrl: `${process.env.PUBLIC_URL}/checkout/success`,
        receiptButtonText: 'Volver a la app',
        receiptLinkUrl: `${process.env.PUBLIC_URL}/account`,
      },
      testMode: process.env.LEMONSQUEEZY_API_KEY!.startsWith('lmnsq_test_'),
    });

    if (checkout.error) {
      console.error('[ls.checkout] error', { code: 'sdk_error' });
      return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
    }

    return NextResponse.json({ url: checkout.data?.data?.attributes?.url });
  } catch (err: any) {
    console.error('[ls.checkout] exception', { code: err.code ?? 'unknown' });
    return NextResponse.json({ error: 'checkout_failed' }, { status: 500 });
  }
}
```

## Express equivalent

Same shape inside an Express handler with `requireAuth` middleware:

```ts
router.post('/api/checkout', requireAuth, async (req, res) => {
  const { productId } = req.body;
  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product?.lemonsqueezy_variant_id) {
    return res.status(404).json({ error: 'product_not_found' });
  }

  const checkout = await createCheckout(
    process.env.LEMONSQUEEZY_STORE_ID!,
    product.lemonsqueezy_variant_id,
    {
      checkoutData: {
        email: req.user.email,
        custom: { user_id: req.user.id, product_id: product.id },
      },
      productOptions: {
        redirectUrl: `${process.env.PUBLIC_URL}/checkout/success`,
      },
      testMode: process.env.LEMONSQUEEZY_API_KEY!.startsWith('lmnsq_test_'),
    }
  );

  res.json({ url: checkout.data?.data?.attributes?.url });
});
```

## Granting access on `order_created`

The webhook handler (in `webhook.md`) receives `order_created` after a successful checkout. Resolve `user_id` from `custom_data` and grant access:

```ts
async function handleOrderCreated(data: any, customData?: Record<string, any>) {
  const userId = customData?.user_id;
  const productId = customData?.product_id;
  if (!userId || !productId) {
    console.warn('[ls.webhook] order_created without custom_data', { order_id: data.id });
    return;
  }
  // Grant access
  await db.userEntitlement.create({
    data: { user_id: userId, product_id: productId, source: 'lemonsqueezy' },
  });
  // Optional: also persist in pagokit_payments for cross-provider reporting
}
```

## Embedded checkout (overlay)

To open the checkout in an overlay on your site (instead of redirecting):

1. Set `embed: true` in `checkoutOptions`.
2. Load LS's overlay script on the page: `<script src="https://app.lemonsqueezy.com/js/lemon.js" defer></script>`.
3. Trigger the overlay with the returned URL: `LemonSqueezy.Url.Open(url)`.

```tsx
// components/CheckoutButton.tsx
'use client';

import Script from 'next/script';

export function CheckoutButton({ productId }: { productId: string }) {
  async function handleClick() {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId }),
    });
    const { url } = await res.json();
    // @ts-expect-error — LemonSqueezy is global from lemon.js
    LemonSqueezy.Url.Open(url);
  }

  return (
    <>
      <Script src="https://app.lemonsqueezy.com/js/lemon.js" strategy="afterInteractive" />
      <button onClick={handleClick}>Comprar</button>
    </>
  );
}
```

## Anti-patterns

- ❌ Skipping `custom_data` — you can't link the LS order to your user later.
- ❌ Hardcoding `testMode: true` or `false`. Derive from key prefix so production and dev work seamlessly.
- ❌ Trusting the `redirectUrl` query params for granting access. Wait for the webhook.
- ❌ Collecting tax_id, billing address, or VAT fields. LS owns this as MoR.
- ❌ Using `loadCheckout` in a useEffect that re-runs — re-creates the checkout. Click handler only.

## Security rules cited

- Rule 11: collect only email + name from session for `checkoutData`. LS handles the rest.
- Rule 12: PAN never touches your code; LS hosts the checkout.
