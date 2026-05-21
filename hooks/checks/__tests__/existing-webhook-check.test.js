'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Helper: create a temp project dir with a pre-existing Clerk webhook
function setupClerkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagokit-test-clerk-'));
  const webhookDir = path.join(dir, 'app', 'api', 'webhook');
  fs.mkdirSync(webhookDir, { recursive: true });
  fs.writeFileSync(
    path.join(webhookDir, 'route.ts'),
    `import { Webhook } from 'svix';\nimport { headers } from '@clerk/nextjs';\nexport async function POST(req) {\n  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET);\n  return new Response(null, { status: 200 });\n}\n`
  );
  return dir;
}

function setupCleanProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagokit-test-clean-'));
  return dir;
}

// Test cases require building ctx with real filesystem state
module.exports = (() => {
  const cases = [];

  // Case 1: writing webhook to a path where Clerk webhook lives — deny
  {
    const projectDir = setupClerkProject();
    cases.push({
      name: 'New webhook on top of existing Clerk webhook is denied',
      check: 'existing-webhook-check',
      ctx: {
        filePath: path.join(projectDir, 'app/api/webhook/route.ts'),
        content: `import { stripe } from '@/lib/payments/stripe';\nexport async function POST(req) { /* new */ }\n`,
        toolName: 'Write',
        projectDir,
      },
      expected: 'deny',
    });
  }

  // Case 2: writing webhook to a NEW path (namespaced) — pass
  {
    const projectDir = setupClerkProject();
    cases.push({
      name: 'Writing webhook at a namespaced path (no existing file) passes',
      check: 'existing-webhook-check',
      ctx: {
        filePath: path.join(projectDir, 'app/api/webhook/stripe/route.ts'),
        content: `import { stripe } from '@/lib/payments/stripe';\nexport async function POST(req) { /* new */ }\n`,
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 3: Edit operations on existing files always pass (user knows what they're doing)
  {
    const projectDir = setupClerkProject();
    cases.push({
      name: 'Edit (not Write) on existing webhook passes',
      check: 'existing-webhook-check',
      ctx: {
        filePath: path.join(projectDir, 'app/api/webhook/route.ts'),
        content: 'new content',
        toolName: 'Edit',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 4: pagokit-ignore tag bypass
  {
    const projectDir = setupClerkProject();
    cases.push({
      name: 'pagokit-ignore tag in new content bypasses the check',
      check: 'existing-webhook-check',
      ctx: {
        filePath: path.join(projectDir, 'app/api/webhook/route.ts'),
        content: `// pagokit-ignore: existing-webhook-check -- migrating away from Clerk\nimport { stripe } from '@/lib/payments/stripe';\nexport async function POST(req) {}\n`,
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 5: clean project, no existing webhook — pass
  {
    const projectDir = setupCleanProject();
    cases.push({
      name: 'Clean project (no existing webhook) passes',
      check: 'existing-webhook-check',
      ctx: {
        filePath: path.join(projectDir, 'app/api/webhook/stripe/route.ts'),
        content: `import { stripe } from '@/lib/payments/stripe';\nexport async function POST(req) {}\n`,
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  return cases;
})();
