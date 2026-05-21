# Stripe — Tax Activation Template

Enable Stripe Tax to auto-calculate VAT/sales tax/GST on every charge. Requires the user to enable Stripe Tax in the dashboard first (Settings → Tax → Activate).

## When to use this template

`payment-advisor` recommends adding Stripe Tax when:
- The seller is US-based and sells across multiple US states.
- The seller is selling cross-border to EU buyers without using a Merchant of Record.
- The user explicitly asks "handle tax for me" but doesn't want a full MoR like Lemon Squeezy.

If the user wants tax fully delegated (no compliance work at all), `payment-advisor` recommends Lemon Squeezy or Stripe Managed Payments instead — not this template.

## Activation on Checkout Sessions

```ts
const session = await stripe.checkout.sessions.create(
  {
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    automatic_tax: { enabled: true }, // ← key flag
    customer_update: { address: 'auto', name: 'auto' }, // required for tax calc
    tax_id_collection: { enabled: true }, // optional, for B2B customers
    success_url: `${process.env.PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.PUBLIC_URL}/cancel`,
  },
  { idempotencyKey: randomUUID() }
);
```

Stripe will:
1. Calculate tax based on buyer's billing address.
2. Display the tax line item on the hosted checkout page.
3. Remit the tax to the relevant jurisdiction on your behalf when filing season comes (you still need a Stripe Tax subscription).

## Activation on Payment Intents (embedded checkout)

```ts
const intent = await stripe.paymentIntents.create(
  {
    amount: subtotal,
    currency: 'usd',
    automatic_tax: { enabled: true },
    customer: customerId, // tax calculation needs an address
    metadata: { product_id: product.id },
  },
  { idempotencyKey: randomUUID() }
);
```

For Payment Intents, you must collect the customer's billing address via Stripe Elements (`<AddressElement>`) before confirming.

## Subscriptions with tax

```ts
const sub = await stripe.subscriptions.create(
  {
    customer: customerId,
    items: [{ price: priceId }],
    automatic_tax: { enabled: true },
  },
  { idempotencyKey: randomUUID() }
);
```

Tax is recalculated on each recurring invoice.

## Tax ID collection (B2B)

For B2B transactions where the buyer is a registered business with a VAT/tax ID:

```ts
tax_id_collection: { enabled: true }
```

Stripe asks the buyer for their tax ID during checkout, validates the format, and applies reverse-charge rules where applicable (e.g., EU B2B cross-border).

## What Stripe Tax does NOT do

- It does NOT file your tax returns. You still file with the tax authority; Stripe provides reports.
- It does NOT apply discounts/coupons to the tax line — tax is on the post-discount subtotal.
- It does NOT handle jurisdictions where Stripe doesn't have nexus on your behalf — that's your remit.

## Anti-patterns

- ❌ Enabling `automatic_tax` without configuring Stripe Tax in the dashboard. The Checkout Session creation will fail.
- ❌ Storing the calculated tax amount in your DB as "definitive". Stripe is the source of truth; query their API at refund time to compute the correct tax-inclusive refund.
- ❌ Showing the buyer a "0% tax" line in regions where Stripe hasn't calculated yet — wait for `automatic_tax.status === 'complete'` on the session.

## Compatibility note

Stripe Tax adds a few hundred milliseconds to checkout creation latency (it queries tax tables). Acceptable for most use cases; profile if you're optimizing for sub-200ms checkouts.

## References

- Stripe Tax overview: https://stripe.com/docs/tax
- automatic_tax on Checkout: https://stripe.com/docs/payments/checkout/taxes
- Tax ID collection: https://stripe.com/docs/tax/tax-ids
