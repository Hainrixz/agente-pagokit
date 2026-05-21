'use strict';

const STRIPE_GOOD = `
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
export const runtime = 'nodejs';
export async function POST(request) {
  const sig = request.headers.get('stripe-signature');
  const rawBody = await request.text();
  const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  return new Response(null, { status: 200 });
}
`;

const STRIPE_BAD = `
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
export const runtime = 'nodejs';
export async function POST(request) {
  const body = await request.json();
  return new Response(null, { status: 200 });
}
`;

const STRIPE_WRAPPER_WITH_TAG = `
import { verifyMyStripeWebhook } from '@/lib/auth/payments';
import { stripe } from '@/lib/payments/stripe';
// @pagokit:signature-verified -- uses lib/auth/payments
export async function POST(request) {
  const result = await verifyMyStripeWebhook(request);
  return new Response(null, { status: 200 });
}
`;

const STRIPE_WITH_IGNORE = `
import { stripe } from '@/lib/payments/stripe';
// pagokit-ignore: webhook-has-signature -- custom verifier in lib/auth
export async function POST(request) {
  return new Response(null, { status: 200 });
}
`;

const CLERK_WEBHOOK = `
import { Webhook } from 'svix';
import { headers } from '@clerk/nextjs';
export async function POST(request) {
  const webhook = new Webhook(process.env.CLERK_WEBHOOK_SECRET);
  const evt = webhook.verify(payload, headers);
  return new Response(null, { status: 200 });
}
`;

const MP_GOOD = `
import crypto from 'node:crypto';
import { mpPayment } from '@/lib/payments/mercadopago';
function verifyMpSignature(sig, requestId, dataId, secret) {
  const h = crypto.createHmac('sha256', secret).update('id:' + dataId).digest('hex');
  return h === sig;
}
export async function POST(request) {
  const ok = verifyMpSignature(request.headers.get('x-signature'), '', '', process.env.MP_WEBHOOK_SECRET);
  if (!ok) return new Response(null, { status: 400 });
  return new Response(null, { status: 200 });
}
`;

const LS_GOOD = `
import crypto from 'node:crypto';
function verifyLemonSignature(body, sig, secret) {
  const computed = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return computed === sig;
}
import { db } from '@/lib/db';
export async function POST(request) {
  const sig = request.headers.get('x-signature');
  const rawBody = await request.text();
  if (!verifyLemonSignature(rawBody, sig, process.env.LEMONSQUEEZY_WEBHOOK_SECRET)) {
    return new Response(null, { status: 400 });
  }
  return new Response(null, { status: 200 });
}
`;

module.exports = [
  {
    name: 'Stripe webhook with constructEvent passes',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: STRIPE_GOOD,
    },
    expected: 'pass',
  },
  {
    name: 'Stripe webhook without signature verification is denied',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: STRIPE_BAD,
    },
    expected: 'deny',
  },
  {
    name: 'Custom verifier with @pagokit:signature-verified tag passes',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: STRIPE_WRAPPER_WITH_TAG,
    },
    expected: 'pass',
  },
  {
    name: 'pagokit-ignore tag bypasses the rule',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: STRIPE_WITH_IGNORE,
    },
    expected: 'pass',
  },
  {
    name: 'Clerk webhook (not a payment provider) is not flagged',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/clerk/route.ts',
      content: CLERK_WEBHOOK,
    },
    expected: 'pass',
  },
  {
    name: 'Mercado Pago webhook with custom verifyMpSignature passes',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/mercadopago/route.ts',
      content: MP_GOOD,
    },
    expected: 'pass',
  },
  {
    name: 'Lemon Squeezy webhook with verifyLemonSignature passes',
    check: 'webhook-has-signature',
    ctx: {
      filePath: '/proj/app/api/webhook/lemonsqueezy/route.ts',
      content: LS_GOOD,
    },
    expected: 'pass',
  },
];
