'use strict';

const GOOD_NODE_RANDOMUUID = `
import { randomUUID } from 'node:crypto';
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const idempotencyKey = randomUUID();
  const session = await stripe.checkout.sessions.create({ mode: 'payment' }, { idempotencyKey });
  return Response.json({ url: session.url });
}
`;

const GOOD_UUID_PKG = `
import { v4 as uuidv4 } from 'uuid';
export async function POST(request) {
  const key = uuidv4();
  const result = await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' }, { idempotencyKey: key });
  return Response.json(result);
}
`;

const BAD_MATH_RANDOM = `
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const idempotencyKey = Math.random().toString();
  await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' }, { idempotencyKey });
  return Response.json({});
}
`;

const BAD_DATE_NOW = `
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const idempotencyKey = 'key_' + Date.now();
  await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' }, { idempotencyKey });
  return Response.json({});
}
`;

const WARN_NO_GENERATOR_VISIBLE = `
import { generateKey } from '@/lib/helpers';
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const idempotencyKey = generateKey();
  await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' }, { idempotencyKey });
  return Response.json({});
}
`;

const IGNORE_TAGGED = `
import { stripe } from '@/lib/payments/stripe';
// pagokit-ignore: idempotency-canonical -- key comes from external auth system
export async function POST(request) {
  const idempotencyKey = req.user.session_id;
  await stripe.paymentIntents.create({ amount: 1000, currency: 'usd' }, { idempotencyKey });
  return Response.json({});
}
`;

const NOT_A_PAYMENT_FILE = `
// Just a random utility
export function isEven(n) { return n % 2 === 0; }
`;

module.exports = [
  {
    name: 'crypto.randomUUID() passes',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: GOOD_NODE_RANDOMUUID,
    },
    expected: 'pass',
  },
  {
    name: 'uuid package v4 passes',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: GOOD_UUID_PKG,
    },
    expected: 'pass',
  },
  {
    name: 'Math.random near idempotency is denied',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: BAD_MATH_RANDOM,
    },
    expected: 'deny',
  },
  {
    name: 'Date.now near idempotency is denied',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: BAD_DATE_NOW,
    },
    expected: 'deny',
  },
  {
    name: 'No visible generator (likely helper) emits warn',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: WARN_NO_GENERATOR_VISIBLE,
    },
    expected: 'warn',
  },
  {
    name: 'pagokit-ignore bypass passes',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/app/api/checkout/route.ts',
      content: IGNORE_TAGGED,
    },
    expected: 'pass',
  },
  {
    name: 'Non-payment file is not flagged',
    check: 'idempotency-canonical',
    ctx: {
      filePath: '/proj/lib/utils.ts',
      content: NOT_A_PAYMENT_FILE,
    },
    expected: 'pass',
  },
];
