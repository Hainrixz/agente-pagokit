'use strict';

const WEBHOOK_LOGS_FULL_EVENT = `
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const rawBody = await request.text();
  const event = stripe.webhooks.constructEvent(rawBody, request.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  console.log(event);
  return new Response(null, { status: 200 });
}
`;

const WEBHOOK_LOGS_REQ_BODY = `
import { stripe } from '@/lib/payments/stripe';
export async function POST(req) {
  console.log(req.body);
  return new Response(null, { status: 200 });
}
`;

const WEBHOOK_LOGS_SPECIFIC_FIELDS = `
import Stripe from 'stripe';
import { stripe } from '@/lib/payments/stripe';
export async function POST(request) {
  const rawBody = await request.text();
  const event = stripe.webhooks.constructEvent(rawBody, request.headers.get('stripe-signature'), process.env.STRIPE_WEBHOOK_SECRET);
  console.log({ id: event.id, type: event.type, created: event.created });
  return new Response(null, { status: 200 });
}
`;

const WEBHOOK_PYTHON_PRINT_PAYLOAD = `
import stripe
@app.post("/api/webhook/stripe")
async def webhook(request):
    body = await request.body()
    event = stripe.Webhook.construct_event(body, request.headers["stripe-signature"], os.environ["STRIPE_WEBHOOK_SECRET"])
    print(event)
    return {"ok": True}
`;

const IGNORE_TAGGED = `
import { stripe } from '@/lib/payments/stripe';
// pagokit-ignore: no-pii-logs -- redacted upstream in middleware
export async function POST(request) {
  const event = stripe.webhooks.constructEvent('', '', '');
  console.log(event);
  return new Response(null, { status: 200 });
}
`;

const NOT_A_WEBHOOK = `
export function add(a, b) { console.log(a, b); return a + b; }
`;

module.exports = [
  {
    name: 'Logging full event in webhook emits warn',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: WEBHOOK_LOGS_FULL_EVENT,
    },
    expected: 'warn',
  },
  {
    name: 'Logging req.body in webhook emits warn',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: WEBHOOK_LOGS_REQ_BODY,
    },
    expected: 'warn',
  },
  {
    name: 'Structured logging of specific fields passes',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: WEBHOOK_LOGS_SPECIFIC_FIELDS,
    },
    expected: 'pass',
  },
  {
    name: 'Python print(event) emits warn',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/app/webhook.py',
      content: WEBHOOK_PYTHON_PRINT_PAYLOAD,
    },
    expected: 'warn',
  },
  {
    name: 'pagokit-ignore tag passes',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/app/api/webhook/stripe/route.ts',
      content: IGNORE_TAGGED,
    },
    expected: 'pass',
  },
  {
    name: 'Non-webhook file is not flagged',
    check: 'no-pii-logs',
    ctx: {
      filePath: '/proj/lib/utils.ts',
      content: NOT_A_WEBHOOK,
    },
    expected: 'pass',
  },
];
