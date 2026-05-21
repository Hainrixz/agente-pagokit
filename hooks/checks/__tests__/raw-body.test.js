'use strict';

const NEXT_GOOD = `
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

const NEXT_BAD_JSON_BEFORE_VERIFY = `
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
export const runtime = 'nodejs';
export async function POST(request) {
  const event = await request.json();
  const sig = request.headers.get('stripe-signature');
  return new Response(null, { status: 200 });
}
`;

const EXPRESS_GOOD = `
import express from 'express';
import Stripe from 'stripe';
import { stripe } from './lib/payments/stripe';
const app = express();
app.post(
  '/api/webhook/stripe',
  express.raw({ type: 'application/json', limit: '256kb' }),
  (req, res) => {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    res.status(200).send();
  }
);
app.use(express.json());
`;

const EXPRESS_BAD_NO_RAW = `
import express from 'express';
import Stripe from 'stripe';
import { stripe } from './lib/payments/stripe';
const app = express();
app.use(express.json());
app.post('/api/webhook/stripe', (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  res.status(200).send();
});
`;

const FASTAPI_BAD = `
from fastapi import FastAPI, Request, HTTPException
import stripe
app = FastAPI()
@app.post("/api/webhook/stripe")
async def webhook(request: Request):
    event = await request.json()
    sig = request.headers.get("Stripe-Signature")
    return {"ok": True}
`;

const IGNORE_TAGGED = `
// pagokit-ignore: raw-body -- we use a custom wrapper that handles raw body internally
import { stripe } from '@/lib/payments/stripe';
export const runtime = 'nodejs';
export async function POST(request) {
  const event = await request.json();
  return new Response(null, { status: 200 });
}
`;

module.exports = [
  {
    name: 'Next.js App Router with request.text() passes',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: NEXT_GOOD,
      projectDir: '/proj',
    },
    expected: 'pass',
  },
  {
    name: 'Next.js with request.json() is denied',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: NEXT_BAD_JSON_BEFORE_VERIFY,
      projectDir: '/proj',
    },
    expected: 'deny',
  },
  {
    name: 'Express with express.raw passes',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/src/routes/webhook.ts',
      content: EXPRESS_GOOD,
      projectDir: '/proj',
    },
    expected: 'pass',
  },
  {
    name: 'Express without express.raw is denied',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/src/routes/webhook.ts',
      content: EXPRESS_BAD_NO_RAW,
      projectDir: '/proj',
    },
    expected: 'deny',
  },
  {
    name: 'FastAPI with request.json() before verify is denied',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/app/webhook.py',
      content: FASTAPI_BAD,
      projectDir: '/proj',
    },
    expected: 'deny',
  },
  {
    name: 'pagokit-ignore bypass passes',
    check: 'raw-body',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: IGNORE_TAGGED,
      projectDir: '/proj',
    },
    expected: 'pass',
  },
];
